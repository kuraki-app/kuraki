<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { session } from '$lib/stores';
  import LoadError from '$lib/components/LoadError.svelte';
  import { Palette, Smartphone, Activity, ChevronRight } from '@lucide/svelte';
  import { fileSize, relativeTime } from '$lib/format';
  import type { BackupStatus, IntegrityRun, LibraryStats } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SectionHeading from '$lib/components/SectionHeading.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import { Button } from '$lib/components/ui/button';

  let stats: LibraryStats | null = null;
  let integrity: IntegrityRun | null = null;
  let backup: BackupStatus | null = null;
  let loading = true;

  type Resource = 'stats' | 'integrity' | 'backup';
  let errors: Record<Resource, boolean> = { stats: false, integrity: false, backup: false };
  let pending: Record<Resource, boolean> = { stats: false, integrity: false, backup: false };

  async function load(resource: Resource) {
    if (pending[resource]) return;
    pending = { ...pending, [resource]: true };
    try {
      if (resource === 'stats') stats = await api.stats();
      else if (resource === 'integrity') integrity = (await api.integrity()).last;
      else backup = await api.backup();
      errors = { ...errors, [resource]: false };
    } catch {
      errors = { ...errors, [resource]: true };
    } finally {
      pending = { ...pending, [resource]: false };
    }
  }

  onMount(async () => {
    await Promise.all([load('stats'), load('integrity'), load('backup')]);
    loading = false;
  });

  // The status endpoint does not publish the configured schedule. Show the
  // last run's age without inventing a deadline for weekly/monthly backups.
  $: backupClass = backup?.last?.status === 'error' ? 'error' : 'off';

  const integrityLabel = (s: string) =>
    s === 'clean' ? 'All originals verified' : s === 'problems' ? 'Problems found' : s === 'running' ? 'Verifying…' : 'Verification error';

  $: maxYear = stats ? Math.max(1, ...stats.by_year.map((y) => y.count)) : 1;

  // Absent on a platform or storage backend that cannot report it. Zero is not
  // a fallback: "0 bytes free" reads as a full disk, so the whole block hides
  // rather than claiming something untrue.
  $: diskFree = stats?.disk_free_bytes ?? 0;
  $: diskTotal = stats?.disk_total_bytes ?? 0;
  $: diskPercent = diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0;
</script>

<PageHeader title="Overview" subtitle="Your library, storage, and peace of mind.">
  <Button variant="outline" href="/api/export" download>Export library (.zip)</Button>
</PageHeader>

<div class="quick-links">
  {#each [{ href: '/settings/appearance', title: 'Make it yours', detail: 'Theme and photo grid', icon: Palette }, { href: '/settings/devices', title: 'Connect a device', detail: 'Back up your phone', icon: Smartphone }, { href: '/settings/activity', title: 'Recent activity', detail: 'Imports and processing', icon: Activity }] as link}
    <a href={link.href}><svelte:component this={link.icon} size={20} aria-hidden="true" /><span><strong>{link.title}</strong><small>{link.detail}</small></span><ChevronRight size={16} aria-hidden="true" /></a>
  {/each}
</div>

{#if loading}
  <p class="muted" role="status">Loading your library…</p>
{:else}
  {#if errors.stats}<LoadError message="Library statistics unavailable" retryLabel="Retry library statistics" retry={() => load('stats')} busy={pending.stats} />{/if}
  {#if stats}
  <div class="cards">
    <StatCard value={stats.total.toLocaleString()} label="Photos & videos" />
    <StatCard value={fileSize(stats.total_bytes)} label="Total size" />
    <StatCard value={stats.images.toLocaleString()} label="Photos" />
    <StatCard value={stats.videos.toLocaleString()} label="Videos" />

  </div>

  <div class="library-links">
    <a href="/favorites">{stats.favorites.toLocaleString()} favorites</a>
    <a href="/albums">{stats.albums.toLocaleString()} albums</a>
    <a href="/places">{stats.places.toLocaleString()} places</a>
    <a href="/trash">{stats.trashed.toLocaleString()} in trash</a>
  </div>
  {#if diskTotal > 0}
    <!-- Filesystem usage includes other applications; library size is shown
         separately so this never claims all used storage belongs to Kuraki. -->
    <section class="disk">
      <div class="disk-bar" role="img" aria-label="{diskPercent}% of the disk is in use">
        <div class="disk-fill" style="width: {Math.min(100, diskPercent)}%"></div>
      </div>
      <span class="muted">
        {fileSize(diskFree)} free of {fileSize(diskTotal)} · {fileSize(stats.total_bytes)} in your library
      </span>
    </section>
  {/if}

  {/if}
  <div class="health-heading"><SectionHeading>Library health</SectionHeading></div>
  {#if errors.integrity}<LoadError message="Integrity status unavailable" retryLabel="Retry integrity status" retry={() => load('integrity')} busy={pending.integrity} />
  {:else}<section class="integrity {integrity?.status ?? ''}">
    <div class="int-text">
      <strong>Integrity</strong>
      {#if integrity}
        <span>{integrityLabel(integrity.status)} · {integrity.checked.toLocaleString()} checked{#if integrity.problems}, {integrity.problems} problem{integrity.problems === 1 ? '' : 's'}{/if}{#if integrity.finished_at}{' · '}{relativeTime(integrity.finished_at)}{/if}</span>
      {:else}
        <span class="prose">Not verified yet</span>
      {/if}
    </div>
  </section>
  {/if}
  {#if $session.user?.role === 'admin'}<p class="see-server"><a href="/settings/server">Run a check or scan for duplicates →</a></p>{/if}

  {#if errors.backup}<LoadError message="Backup status unavailable" retryLabel="Retry backup status" retry={() => load('backup')} busy={pending.backup} />
  {:else}<section class="integrity {backupClass}">
    <div class="int-text">
      <strong>Backup</strong>
      {#if !backup?.enabled}
        <span class="prose">Automatic backup is off. Set a backup directory in <a href="/settings/server">Settings → Server</a> to keep scheduled copies, or run <code>kuraki backup</code> by hand.</span>
      {:else if backup.last?.status === 'error'}
        <span>Last automatic backup failed{#if backup.last.finished_at}{' · '}{relativeTime(backup.last.finished_at)}{/if}{#if backup.last.error}{' · '}{backup.last.error}{/if}</span>
      {:else if backup.last?.status === 'running'}
        <span>Automatic backup in progress · started {relativeTime(backup.last.started_at)}</span>
      {:else if backup.last}
        <span>Last backup {fileSize(backup.last.bytes)}{#if backup.last.finished_at}{' · '}{relativeTime(backup.last.finished_at)}{/if}</span>
      {:else}
        <span class="prose">Automatic backup is on; no backup has run yet.</span>
      {/if}
    </div>
  </section>

  {/if}
  {#if stats && stats.by_year.length > 0}
    <section class="years">
      <SectionHeading>By year</SectionHeading>
      <div class="bars">
        {#each stats.by_year as y (y.year)}
          <div class="row">
            <span class="yr">{y.year || '—'}</span>
            <div class="track"><div class="fill" style="width:{(y.count / maxYear) * 100}%"></div></div>
            <span class="n">{y.count.toLocaleString()}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<style>
  .quick-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
  .quick-links a { display: flex; align-items: center; gap: 12px; border: 1px solid var(--border); border-radius: var(--collection-radius); padding: 16px; color: var(--foreground); text-decoration: none; }
  .quick-links a:hover { background: var(--accent); }
  .quick-links span { display: grid; gap: 4px; flex: 1; }
  .quick-links strong { font-size: 14px; font-weight: 550; }
  .quick-links small { color: var(--muted-foreground); font-size: 12px; }
  .quick-links :global(svg) { flex-shrink: 0; }
  .library-links { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 16px 0; font-size: 13px; color: var(--muted-foreground); }
  .library-links a:hover { color: var(--foreground); text-decoration: underline; }
  .health-heading { margin-top: 32px; }


  .muted {
    color: var(--muted-foreground);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  /* Spacing comes from --space-step throughout, so the same expressions land
   * on a 4px rhythm here and would land on 8px if this page were ever Kura.
   * They were hardcoded, which is why the Vault register only reached the page
   * frame and stopped at its contents. */
  .disk {
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-step) * 2);
    margin-top: calc(var(--space-step) * 4);
  }
  .disk-bar {
    height: 8px;
    border-radius: var(--collection-radius);
    background: var(--muted);
    overflow: hidden;
  }
  .disk-fill {
    height: 100%;
    background: var(--primary);
  }

  .integrity {
    display: flex;
    align-items: center;
    gap: calc(var(--space-step) * 3);
    margin-top: calc(var(--space-step) * 4);
    padding: calc(var(--space-step) * 3) calc(var(--space-step) * 4);
    border: 1px solid var(--frame-border-color, var(--border));
    /* Operational density with the same soft card geometry as the gallery. */
    border-radius: var(--collection-radius);
    box-shadow: var(--frame-shadow);
    background: var(--card);
  }
  .integrity.problems,
  .integrity.error {
    border-color: var(--destructive-border);
    background: var(--destructive-bg);
  }
  .int-text {
    display: grid;
    gap: 2px;
    margin-right: auto;
    min-width: 0;
  }
  /* "Integrity" and "Backup" name a readout, so they take the label treatment
   * — micro-caps mono in the Vault — and the readout itself takes the data
   * face. 0/O and 1/l must not be ambiguous in a status line about whether the
   * backup ran. */
  .int-text strong {
    color: var(--text-dim);
    font-family: var(--frame-label-font);
    font-size: var(--frame-label-size);
    font-weight: 600;
    letter-spacing: var(--frame-label-tracking);
    text-transform: var(--frame-label-transform);
  }
  .int-text span {
    color: var(--muted-foreground);
    font-family: var(--frame-data-font);
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  /* Mono is for counts, sizes, paths and timestamps — the spec's "hashes,
   * paths, counts, IDs". A full sentence explaining how to turn backups on is
   * prose, and setting it in the data face makes it harder to read while
   * saying nothing true about it. Same panel, two jobs. */
  .int-text span.prose {
    font-family: var(--font-sans);
    font-size: 13px;
  }
  .int-text span.prose code {
    font-family: var(--font-mono);
  }
  .int-text span a {
    color: var(--foreground);
  }
  .integrity.problems .int-text span,
  .integrity.error .int-text span {
    color: var(--destructive);
  }
  .see-server {
    margin: 8px 0 0;
    font-size: 13px;
  }
  .see-server a {
    color: var(--foreground);
  }
  .years {
    margin-top: calc(var(--space-step) * 7);
  }
  .bars {
    display: grid;
    gap: calc(var(--space-step) * 2);
  }
  .row {
    display: grid;
    grid-template-columns: 48px 1fr 60px;
    align-items: center;
    gap: 10px;
  }
  /* Year and count are figures in a column: mono and tabular, so the digits
   * line up and the rows do not jitter as the numbers change. */
  .yr {
    color: var(--muted-foreground);
    font-family: var(--frame-data-font);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 10px;
    border-radius: var(--collection-radius);
    background: var(--muted);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: var(--collection-radius);
    background: var(--primary);
  }
  .n {
    text-align: right;
    color: var(--text-dim);
    font-family: var(--frame-data-font);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  @container settings (max-width: 700px) { .quick-links { grid-template-columns: 1fr; } .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
