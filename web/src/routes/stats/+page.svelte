<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize, relativeTime } from '$lib/format';
  import type { IntegrityRun, LibraryStats } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import { Button } from '$lib/components/ui/button';

  let stats: LibraryStats | null = null;
  let integrity: IntegrityRun | null = null;
  let verifying = false;
  let loading = true;

  onMount(async () => {
    try {
      const [s, i] = await Promise.all([api.stats(), api.integrity()]);
      stats = s;
      integrity = i.last;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      loading = false;
    }
  });

  async function verifyNow() {
    verifying = true;
    try {
      await api.runIntegrity();
      showToast('Verifying library…');
      setTimeout(refreshIntegrity, 2000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Verify failed');
    }
  }
  async function refreshIntegrity() {
    try {
      integrity = (await api.integrity()).last;
    } catch {
      /* ignore */
    }
    if (integrity?.status === 'running') {
      setTimeout(refreshIntegrity, 2000);
    } else {
      verifying = false;
    }
  }

  const integrityLabel = (s: string) =>
    s === 'clean' ? 'All originals verified' : s === 'problems' ? 'Problems found' : s === 'running' ? 'Verifying…' : 'Verification error';

  $: maxYear = stats ? Math.max(1, ...stats.by_year.map((y) => y.count)) : 1;
</script>

<PageHeader title="Library">
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
  </div>

  <section class="integrity {integrity?.status ?? ''}">
    <div class="int-text">
      <strong>Integrity</strong>
      {#if integrity}
        <span>{integrityLabel(integrity.status)} · {integrity.checked.toLocaleString()} checked{#if integrity.problems}, {integrity.problems} problem{integrity.problems === 1 ? '' : 's'}{/if}{#if integrity.finished_at} · {relativeTime(integrity.finished_at)}{/if}</span>
      {:else}
        <span>Not verified yet</span>
      {/if}
    </div>
    <Button variant="outline" disabled={verifying || integrity?.status === 'running'} onclick={verifyNow}>
      {verifying || integrity?.status === 'running' ? 'Verifying…' : 'Verify now'}
    </Button>
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
  .integrity.problems .int-text span,
  .integrity.error .int-text span {
    color: var(--destructive);
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
