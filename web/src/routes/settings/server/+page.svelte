<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { bumpLibrary, showToast } from '$lib/stores';
  import type { SettingInfo, ExternalLibrary } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';

  const BACKUP_KEYS = ['backup_dir', 'backup_interval_hours', 'backup_keep', 'metrics_token'] as const;

  let version = '';
  let restartPending: string[] = [];
  let backupSettings: SettingInfo[] = [];
  let drafts: Record<string, string> = {};
  let touched: Record<string, boolean> = {};
  let saving: Record<string, boolean> = {};
  let loading = true;

  let verifying = false;
  let scanningDuplicates = false;

  let libraries: ExternalLibrary[] = [];
  let libName = '';
  let libPath = '';
  let addingLibrary = false;
  let scanningLibrary: Record<string, boolean> = {};

  onMount(async () => {
    await Promise.all([loadSettings(), loadLibraries()]);
    loading = false;
  });

  async function loadSettings() {
    try {
      const resp = await api.settings();
      version = resp.version;
      restartPending = resp.restart_pending ?? [];
      backupSettings = resp.settings.filter((s) => (BACKUP_KEYS as readonly string[]).includes(s.key));
      for (const s of backupSettings) drafts[s.key] = s.value ?? '';
      touched = {};
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load settings');
    }
  }

  async function loadLibraries() {
    try {
      libraries = (await api.externalLibraries()).libraries;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load external libraries');
    }
  }

  function statusFor(s: SettingInfo): 'applied' | 'pending_restart' | 'pinned' | 'none' {
    if (s.pinned_by_env) return 'pinned';
    if (restartPending.includes(s.key)) return 'pending_restart';
    return 'none';
  }

  async function save(s: SettingInfo) {
    saving = { ...saving, [s.key]: true };
    try {
      const resp = await api.patchSettings({ [s.key]: String(drafts[s.key]) });
      if (resp.rejected?.length) {
        showToast(resp.rejected[0].error);
        return;
      }
      restartPending = resp.pending_restart ?? [];
      if (resp.warnings?.length) {
        showToast(resp.warnings[0].warning);
      } else if (resp.applied?.includes(s.key)) {
        showToast('Saved');
      } else {
        showToast('Saved — takes effect after restart');
      }
      await loadSettings();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      saving = { ...saving, [s.key]: false };
    }
  }

  async function verifyNow() {
    verifying = true;
    try {
      await api.runIntegrity();
      showToast('Verifying library…');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Verify failed');
    } finally {
      setTimeout(() => (verifying = false), 2000);
    }
  }

  let removeTarget: ExternalLibrary | null = null;
  let removeOpen = false;
  let removingLibrary = false;

  function askRemove(lib: ExternalLibrary) {
    removeTarget = lib;
    removeOpen = true;
  }

  async function removeLibrary() {
    if (!removeTarget) return;
    removingLibrary = true;
    try {
      const { removed } = await api.deleteExternalLibrary(removeTarget.id);
      showToast(`Removed ${removeTarget.name} · ${removed} indexed items forgotten`);
      removeOpen = false;
      removeTarget = null;
      await loadLibraries();
      // The library's assets are gone from the timeline too, so anything showing
      // a list needs to reload rather than keep rows that no longer exist.
      bumpLibrary();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove the library');
    } finally {
      removingLibrary = false;
    }
  }

  async function scanDuplicates() {
    scanningDuplicates = true;
    try {
      await api.runDuplicatesScan();
      showToast('Scanning for duplicates…');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setTimeout(() => (scanningDuplicates = false), 2000);
    }
  }

  async function addLibrary() {
    const name = libName.trim();
    const rootPath = libPath.trim();
    if (!name || !rootPath) return;
    addingLibrary = true;
    try {
      await api.createExternalLibrary(name, rootPath);
      libName = '';
      libPath = '';
      await loadLibraries();
      showToast('External library added');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add library');
    } finally {
      addingLibrary = false;
    }
  }

  async function rescan(lib: ExternalLibrary) {
    scanningLibrary = { ...scanningLibrary, [lib.id]: true };
    try {
      await api.scanExternalLibrary(lib.id);
      await loadLibraries();
      showToast(`${lib.name} rescanned`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rescan failed');
    } finally {
      scanningLibrary = { ...scanningLibrary, [lib.id]: false };
    }
  }
</script>

<PageHeader title="Server" subtitle="Backup, maintenance, and external libraries." />

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <section class="group">
    <h2>About</h2>
    <SettingRow id="version" kind="static" label="Version" status="none">
      <code>{version}</code>
    </SettingRow>
  </section>

  <section class="group">
    <h2>Backup</h2>
    {#each backupSettings as s (s.key)}
      <SettingRow
        id={s.key}
        label={{
          backup_dir: 'Backup directory',
          backup_interval_hours: 'Backup interval',
          backup_keep: 'Backups to keep',
          metrics_token: 'Metrics token'
        }[s.key] ?? s.key}
        description={{
          backup_dir: 'Where unattended backups are written. Empty disables automatic backups.',
          backup_interval_hours: 'How often an unattended backup runs.',
          backup_keep: 'How many recent automatic backups to retain.',
          metrics_token: 'Required Bearer token for scrapers reading /metrics. A signed-in owner can always read /metrics directly, without this token. The stored value is never shown once saved — clear the field and save to remove it.'
        }[s.key] ?? ''}
        status={statusFor(s)}
        envVar={s.env_var}
        disabled={s.pinned_by_env}
      >
        <div class="num">
          <Input
            id={s.key}
            type={s.secret ? 'password' : s.type === 'int' ? 'number' : 'text'}
            placeholder={s.secret && s.is_set ? '••••••••' : ''}
            disabled={s.pinned_by_env}
            bind:value={drafts[s.key]}
            oninput={() => (touched[s.key] = true)}
          />
          {#if s.unit}<span class="unit">{s.unit}</span>{/if}
          <Button
            variant="outline"
            size="sm"
            disabled={s.pinned_by_env ||
              saving[s.key] ||
              (s.secret ? !touched[s.key] : String(drafts[s.key]) === (s.value ?? ''))}
            onclick={() => save(s)}
          >
            Save
          </Button>
        </div>
      </SettingRow>
    {/each}
  </section>

  <section class="group">
    <h2>Maintenance</h2>
    <div class="actions">
      <Button variant="outline" disabled={verifying} onclick={verifyNow}>
        {verifying ? 'Verifying…' : 'Run integrity check'}
      </Button>
      <Button variant="outline" disabled={scanningDuplicates} onclick={scanDuplicates}>
        {scanningDuplicates ? 'Scanning…' : 'Scan for duplicates'}
      </Button>
    </div>
    <p class="hint">Progress and results appear on <a href="/settings">Overview</a> and <a href="/duplicates">Duplicates</a>.</p>
  </section>

  <section class="group">
    <h2>External libraries</h2>
    {#if libraries.length > 0}
      <ul class="libs">
        {#each libraries as lib (lib.id)}
          <li>
            <div class="lib-text">
              <strong>{lib.name}</strong>
              <span>{lib.root_path} · {lib.asset_count} assets</span>
            </div>
            <Button variant="outline" size="sm" disabled={scanningLibrary[lib.id]} onclick={() => rescan(lib)}>
              {scanningLibrary[lib.id] ? 'Scanning…' : 'Rescan'}
            </Button>
            <!-- There was no DELETE route at all, so a mistyped root path was
                 permanent from the UI. -->
            <Button variant="outline" size="sm" onclick={() => askRemove(lib)}>Remove</Button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="add-lib">
      <Input placeholder="Name" bind:value={libName} />
      <Input placeholder="/path/on/server" bind:value={libPath} />
      <Button variant="outline" disabled={addingLibrary || !libName.trim() || !libPath.trim()} onclick={addLibrary}>
        {addingLibrary ? 'Adding…' : 'Add'}
      </Button>
    </div>
  </section>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove {removeTarget?.name ?? ''}?"
  body="Kuraki forgets this library and its {removeTarget?.asset_count ?? 0} indexed items. The files themselves are never touched — Kuraki does not own them and never copied them, so nothing is deleted from {removeTarget?.root_path ?? 'disk'}."
  confirmLabel="Remove library"
  destructive
  busy={removingLibrary}
  onconfirm={removeLibrary}
/>

<style>
  .muted {
    color: var(--muted-foreground);
  }
  .group {
    max-width: 640px;
    margin-bottom: 28px;
  }
  .group h2 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-dim);
  }
  .num {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .num :global(input) {
    width: 180px;
  }
  .unit {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .hint a {
    color: var(--foreground);
  }
  .libs {
    list-style: none;
    margin: 8px 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .libs li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .lib-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .lib-text span {
    color: var(--muted-foreground);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .add-lib {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .add-lib :global(input) {
    flex: 1;
  }
</style>
