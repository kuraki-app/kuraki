<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { requestUpload, showToast } from '$lib/stores';
  import { fileSize, relativeTime } from '$lib/format';
  import type { BackupStatus, IntegrityRun, LibraryStats } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SectionHeading from '$lib/components/SectionHeading.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    Upload,
    User,
    Palette,
    SlidersHorizontal,
    Server,
    Smartphone,
    Activity,
    Users,
    Star,
    CalendarClock,
    MapPin,
    Tags,
    Archive,
    EyeOff,
    Copy,
    Trash2,
    Download,
    ChevronRight
  } from '@lucide/svelte';

  const mobilePrimary = [
    { href: '/settings/account', label: 'Account', icon: User },
    { href: '/settings/appearance', label: 'Appearance', icon: Palette },
    { href: '/settings/library', label: 'Library', icon: SlidersHorizontal },
    { href: '/settings/server', label: 'Server & backup', icon: Server },
    { href: '/settings/devices', label: 'Devices', icon: Smartphone }
  ];

  const mobileMore = [
    { href: '/favorites', label: 'Favorites', icon: Star },
    { href: '/memories', label: 'On this day', icon: CalendarClock },
    { href: '/places', label: 'Places', icon: MapPin },
    { href: '/tags', label: 'Tags', icon: Tags },
    { href: '/archive', label: 'Archive', icon: Archive },
    { href: '/hidden', label: 'Hidden', icon: EyeOff },
    { href: '/duplicates', label: 'Duplicates', icon: Copy },
    { href: '/trash', label: 'Trash', icon: Trash2 },
    { href: '/settings/activity', label: 'Activity', icon: Activity },
    { href: '/settings/users', label: 'Users', icon: Users }
  ];

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
  $: libraryDiskPercent = diskTotal > 0 ? Math.min(100, (stats?.total_bytes ?? 0) / diskTotal * 100) : 0;
  $: libraryDiskLabel = libraryDiskPercent > 0 && libraryDiskPercent < 1
    ? '<1%'
    : `${Math.round(libraryDiskPercent)}%`;
</script>

<PageHeader title="Settings">
  <span class="desktop-export"><Button variant="outline" href="/api/export" download>Export library (.zip)</Button></span>
</PageHeader>

<nav class="mobile-directory" aria-label="Settings and library shortcuts">
  <section>
    <h2>This device</h2>
    <button type="button" class="mobile-row" on:click={requestUpload}>
      <Upload size={18} aria-hidden="true" /><span>Upload photos</span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {#each mobilePrimary as item (item.href)}
      <a class="mobile-row" href={item.href}>
        <svelte:component this={item.icon} size={18} aria-hidden="true" />
        <span>{item.label}</span><ChevronRight size={16} aria-hidden="true" />
      </a>
    {/each}
  </section>

  <details>
    <summary>Advanced</summary>
    <div class="mobile-more">
      {#each mobileMore as item (item.href)}
        <a class="mobile-row" href={item.href}>
          <svelte:component this={item.icon} size={18} aria-hidden="true" />
          <span>{item.label}</span><ChevronRight size={16} aria-hidden="true" />
        </a>
      {/each}
      <a class="mobile-row" href="/api/export" download>
        <Download size={18} aria-hidden="true" /><span>Export library</span><ChevronRight size={16} aria-hidden="true" />
      </a>
    </div>
  </details>
</nav>

{#if loading}
  <p class="muted">Loading…</p>
{:else if stats}
  <div class="cards">
    <StatCard value={stats.total.toLocaleString()} label="Photos & videos" />
    <StatCard value={fileSize(stats.total_bytes)} label="Total size" />
    {#if diskTotal > 0}
      <StatCard value={fileSize(diskFree)} label="Free on disk" />
    {/if}
  </div>

  <details class="more-stats">
    <summary>More library details</summary>
    <div class="detail-cards">
      <StatCard value={stats.images.toLocaleString()} label="Photos" />
      <StatCard value={stats.videos.toLocaleString()} label="Videos" />
      <StatCard value={stats.favorites.toLocaleString()} label="Favorites" />
      <StatCard value={stats.albums.toLocaleString()} label="Albums" />
      <StatCard value={stats.places.toLocaleString()} label="Places" />
    </div>
  </details>

  {#if diskTotal > 0}
    <!-- The library's share of the disk, not the disk's used share: the point
         is how much room is left for photos, and on a NAS most of what is used
         may be nothing to do with Kuraki. -->
    <section class="disk">
      <div class="disk-bar" role="img" aria-label="{libraryDiskLabel} of storage is used by this Kuraki library">
        <!-- A library that is a rounding error against a NAS volume computes to
             0% and drew nothing at all, which reads as a bar that failed to
             render rather than as "barely any of this disk is photos". The
             floor keeps a visible sliver whenever there is anything at all. -->
        <div
          class="disk-fill"
          style="width: {libraryDiskPercent > 0 ? `max(3px, ${libraryDiskPercent}%)` : '0'}"
        ></div>
      </div>
      <span class="muted">
        {fileSize(stats.total_bytes)} library · {fileSize(diskTotal)} disk ·
        {fileSize(diskFree)} free
      </span>
    </section>
  {/if}

  <section class="integrity {integrity?.status ?? ''}">
    <div class="int-text">
      <strong>Integrity</strong>
      {#if integrity}
        <span>{integrityLabel(integrity.status)} · {integrity.checked.toLocaleString()} checked{#if integrity.problems}, {integrity.problems} problem{integrity.problems === 1 ? '' : 's'}{/if}{#if integrity.finished_at}{' · '}{relativeTime(integrity.finished_at)}{/if}</span>
      {:else}
        <span class="prose">Not verified yet</span>
      {/if}
    </div>
  </section>
  <p class="see-server"><a href="/settings/server">Run a check or scan for duplicates →</a></p>

  <section class="integrity {backupClass}">
    <div class="int-text">
      <strong>Backup</strong>
      {#if !backup?.enabled}
        <span class="prose">Automatic backup is off. Set a backup directory in <a href="/settings/server">Settings → Server</a> to keep scheduled copies, or run <code>kuraki backup</code> by hand.</span>
      {:else if backup.last?.status === 'error'}
        <span>Last automatic backup failed{#if backup.last.finished_at}{' · '}{relativeTime(backup.last.finished_at)}{/if}{#if backup.last.error}{' · '}{backup.last.error}{/if}</span>
      {:else if backup.last}
        <span>Last backup {fileSize(backup.last.bytes)}{#if backup.last.finished_at}{' · '}{relativeTime(backup.last.finished_at)}{/if}{#if backupStale}{' · overdue'}{/if}</span>
      {:else}
        <span class="prose">Automatic backup is on; no backup has run yet.</span>
      {/if}
    </div>
  </section>

  {#if stats.by_year.length > 0}
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
  .mobile-directory {
    display: none;
  }
  .muted {
    color: var(--muted-foreground);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
  .more-stats {
    margin-top: calc(var(--space-step) * 3);
  }
  .more-stats summary {
    width: fit-content;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }
  .detail-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
    margin-top: calc(var(--space-step) * 2);
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
    border-radius: var(--frame-radius);
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
    /* 4px in the Vault: a panel, not a card. The shadow token is `0 0 #0000`
     * here, so the hairline does the work instead of a lift. */
    border-radius: var(--frame-radius);
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
    font-size: 12px;
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
    border-radius: var(--frame-radius);
    background: var(--muted);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: var(--frame-radius);
    background: var(--primary);
  }
  .n {
    text-align: right;
    color: var(--text-dim);
    font-family: var(--frame-data-font);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 820px) {
    .desktop-export {
      display: none;
    }
    .mobile-directory {
      display: grid;
      gap: 16px;
      margin-top: 16px;
    }
    .mobile-directory section,
    .mobile-directory details {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
    }
    .mobile-directory h2 {
      margin: 0;
      padding: 10px 14px 6px;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .mobile-row {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) 16px;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 46px;
      padding: 10px 14px;
      border: 0;
      border-top: 1px solid var(--border);
      background: transparent;
      color: var(--foreground);
      text-align: left;
      text-decoration: none;
      font: inherit;
    }
    .mobile-row > :global(svg:first-child) {
      color: var(--stamp);
    }
    .mobile-row > :global(svg:last-child) {
      color: var(--text-faint);
    }
    .mobile-directory summary {
      padding: 13px 14px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    .mobile-more {
      display: grid;
    }
  }
</style>
