<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { SettingInfo } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';

  const KEYS = ['trash_retention_days', 'thumbnail_size', 'ocr_enabled', 'change_log_keep'] as const;

  let settings: SettingInfo[] = [];
  let drafts: Record<string, string> = {};
  let pendingRestart: string[] = [];
  let saving: Record<string, boolean> = {};
  let loading = true;

  onMount(load);

  async function load() {
    try {
      const resp = await api.settings();
      settings = resp.settings.filter((s) => (KEYS as readonly string[]).includes(s.key));
      pendingRestart = resp.restart_pending ?? [];
      for (const s of settings) drafts[s.key] = s.value ?? '';
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      loading = false;
    }
  }

  function statusFor(s: SettingInfo): 'applied' | 'pending_restart' | 'pinned' | 'none' {
    if (s.pinned_by_env) return 'pinned';
    if (pendingRestart.includes(s.key)) return 'pending_restart';
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
      pendingRestart = resp.pending_restart ?? [];
      if (resp.applied?.includes(s.key)) showToast('Saved');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      saving = { ...saving, [s.key]: false };
    }
  }

  async function toggleOCR(s: SettingInfo) {
    drafts[s.key] = drafts[s.key] === '1' ? '0' : '1';
    await save(s);
  }
</script>

<PageHeader title="Library" subtitle="Storage, thumbnails, and text search." />

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <section class="group">
    {#each settings as s (s.key)}
      <SettingRow
        id={s.key}
        label={{
          trash_retention_days: 'Trash retention',
          thumbnail_size: 'Thumbnail size',
          ocr_enabled: 'Text search in images (OCR)',
          change_log_keep: 'Sync history kept'
        }[s.key] ?? s.key}
        description={{
          trash_retention_days: 'How long deleted items stay before they are purged for good.',
          thumbnail_size: 'Longest edge, in pixels, for new thumbnails. Existing thumbnails keep their current size until rebuilt.',
          ocr_enabled: 'Recognises text in photos (screenshots, documents) so search can find it. Requires tesseract on the server.',
          change_log_keep: 'How many sync-history rows are kept for the delta feed. Lower values make devices resync more often.'
        }[s.key] ?? ''}
        status={statusFor(s)}
        envVar={s.env_var}
        disabled={s.pinned_by_env}
      >
        {#if s.type === 'bool'}
          <Button
            variant="outline"
            size="sm"
            disabled={s.pinned_by_env || saving[s.key]}
            onclick={() => toggleOCR(s)}
          >
            {drafts[s.key] === '1' ? 'On' : 'Off'}
          </Button>
        {:else}
          <div class="num">
            <Input
              type="number"
              min={s.min || undefined}
              max={s.max || undefined}
              disabled={s.pinned_by_env}
              bind:value={drafts[s.key]}
            />
            {#if s.unit}<span class="unit">{s.unit}</span>{/if}
            <Button
              variant="outline"
              size="sm"
              disabled={s.pinned_by_env || saving[s.key] || drafts[s.key] === s.value}
              onclick={() => save(s)}
            >
              Save
            </Button>
          </div>
        {/if}
      </SettingRow>
    {/each}
  </section>
{/if}

<style>
  .muted {
    color: var(--muted-foreground);
  }
  .group {
    max-width: 640px;
  }
  .num {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .num :global(input) {
    width: 100px;
  }
  .unit {
    color: var(--muted-foreground);
    font-size: 13px;
  }
</style>
