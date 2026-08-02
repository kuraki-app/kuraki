<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize, relativeTime } from '$lib/format';
  import type { BackupStatus, IntegrityRun, LibraryStats } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import { Button } from '$lib/components/ui/button';

  let stats: LibraryStats | null = null;
  let integrity: IntegrityRun | null = null;
  let backup: BackupStatus | null = null;
  let loading = true;

  onMount(async () => {
    try {
      const [s, i, b] = await Promise.all([api.stats(), api.integrity(), api.backup()]);
      stats = s;
      integrity = i.last;
      backup = b;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      loading = false;
    }
  });

  // A configured backup that has not run in over ~1.5 days is stale-ish; surface it.
  $: backupStale =
    !!backup?.enabled &&
    !!backup.last?.finished_at &&
    Date.now() - new Date(backup.last.finished_at).getTime() > 36 * 60 * 60 * 1000;
  $: backupClass = !backup?.enabled
    ? 'off'
    : backup.last?.status === 'error'
      ? 'error'
      : backupStale
        ? 'problems'
        : 'ok';

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

<PageHeader title="Overview" subtitle="Library stats, integrity, and backup status.">
  <Button variant="outline" href="/api/export" download>Export library (.zip)</Button>
</PageHeader>

{#if loading}
  <p class="muted">Loading…</p>
{:else if stats}
  <div class="cards">
    <StatCard value={stats.total.toLocaleString()} label="Photos & videos" />
    <StatCard value={fileSize(stats.total_bytes)} label="Total size" />
    <StatCard value={stats.images.toLocaleString()} label="Photos" />
    <StatCard value={stats.videos.toLocaleString()} label="Videos" />
    <StatCard value={stats.favorites.toLocaleString()} label="Favorites" />
    <StatCard value={stats.albums.toLocaleString()} label="Albums" />
    <StatCard value={stats.places.toLocaleString()} label="Places" />
    <StatCard value={stats.trashed.toLocaleString()} label="In trash" />
    {#if diskTotal > 0}
      <StatCard value={fileSize(diskFree)} label="Free on disk" />
    {/if}
  </div>

  {#if diskTotal > 0}
    <!-- The library's share of the disk, not the disk's used share: the point
         is how much room is left for photos, and on a NAS most of what is used
         may be nothing to do with Kuraki. -->
    <section class="disk">
      <div class="disk-bar" role="img" aria-label="{diskPercent}% of the disk is in use">
        <div class="disk-fill" style="width: {Math.min(100, diskPercent)}%"></div>
      </div>
      <span class="muted">
        {fileSize(stats.total_bytes)} of library in {fileSize(diskTotal)} of storage ·
        {fileSize(diskFree)} free
      </span>
    </section>
  {/if}

  <section class="integrity {integrity?.status ?? ''}">
    <div class="int-text">
      <strong>Integrity</strong>
      {#if integrity}
        <span>{integrityLabel(integrity.status)} · {integrity.checked.toLocaleString()} checked{#if integrity.problems}, {integrity.problems} problem{integrity.problems === 1 ? '' : 's'}{/if}{#if integrity.finished_at} · {relativeTime(integrity.finished_at)}{/if}</span>
      {:else}
        <span>Not verified yet</span>
      {/if}
    </div>
  </section>
  <p class="see-server"><a href="/settings/server">Run a check or scan for duplicates →</a></p>

  <section class="integrity {backupClass}">
    <div class="int-text">
      <strong>Backup</strong>
      {#if !backup?.enabled}
        <span>Automatic backup is off. Set a backup directory in <a href="/settings/server">Settings → Server</a> to keep scheduled copies, or run <code>kuraki backup</code> by hand.</span>
      {:else if backup.last?.status === 'error'}
        <span>Last automatic backup failed{#if backup.last.finished_at} · {relativeTime(backup.last.finished_at)}{/if}{#if backup.last.error} · {backup.last.error}{/if}</span>
      {:else if backup.last}
        <span>Last backup {fileSize(backup.last.bytes)}{#if backup.last.finished_at} · {relativeTime(backup.last.finished_at)}{/if}{#if backupStale} · overdue{/if}</span>
      {:else}
        <span>Automatic backup is on; no backup has run yet.</span>
      {/if}
    </div>
  </section>

  {#if stats.by_year.length > 0}
    <section class="years">
      <h2>By year</h2>
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
  .muted {
    color: var(--muted-foreground);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
  .disk {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }
  .disk-bar {
    height: 8px;
    border-radius: 999px;
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
    gap: 12px;
    margin-top: 16px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
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
  .int-text strong {
    color: var(--foreground);
  }
  .int-text span {
    color: var(--muted-foreground);
    font-size: 13px;
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
    margin-top: 28px;
  }
  .years h2 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-dim);
  }
  .bars {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 48px 1fr 60px;
    align-items: center;
    gap: 10px;
  }
  .yr {
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .track {
    height: 12px;
    border-radius: 6px;
    background: var(--muted);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 6px;
    background: var(--primary);
  }
  .n {
    text-align: right;
    color: var(--text-dim);
    font-size: 14px;
  }
</style>
