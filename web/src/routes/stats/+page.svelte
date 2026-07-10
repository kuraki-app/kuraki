<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize, relativeTime } from '$lib/format';
  import type { IntegrityRun, LibraryStats } from '$lib/types';

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

<header class="head">
  <h1>Library</h1>
  <a class="export" href="/api/export" download>Export library (.zip)</a>
</header>

{#if loading}
  <p class="muted">Loading…</p>
{:else if stats}
  <div class="cards">
    <div class="card"><strong>{stats.total.toLocaleString()}</strong><span>Photos & videos</span></div>
    <div class="card"><strong>{fileSize(stats.total_bytes)}</strong><span>Total size</span></div>
    <div class="card"><strong>{stats.images.toLocaleString()}</strong><span>Photos</span></div>
    <div class="card"><strong>{stats.videos.toLocaleString()}</strong><span>Videos</span></div>
    <div class="card"><strong>{stats.favorites.toLocaleString()}</strong><span>Favorites</span></div>
    <div class="card"><strong>{stats.albums.toLocaleString()}</strong><span>Albums</span></div>
    <div class="card"><strong>{stats.places.toLocaleString()}</strong><span>Places</span></div>
    <div class="card"><strong>{stats.trashed.toLocaleString()}</strong><span>In trash</span></div>
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
    <button type="button" class="verify" disabled={verifying || integrity?.status === 'running'} on:click={verifyNow}>
      {verifying || integrity?.status === 'running' ? 'Verifying…' : 'Verify now'}
    </button>
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
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .head h1 {
    margin: 0;
    margin-right: auto;
    font-size: 22px;
    font-weight: 700;
  }
  .export {
    padding: 8px 14px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #24211f;
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
  }
  .muted {
    color: #6a6259;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
  .card {
    display: grid;
    gap: 4px;
    padding: 16px;
    border: 1px solid #e5ddd1;
    border-radius: 12px;
    background: #fffaf3;
  }
  .card strong {
    font-size: 24px;
    font-weight: 700;
    color: #201d1a;
  }
  .card span {
    color: #8a8175;
    font-size: 13px;
  }
  .integrity {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    padding: 14px 16px;
    border: 1px solid #e5ddd1;
    border-radius: 12px;
    background: #fffaf3;
  }
  .integrity.problems,
  .integrity.error {
    border-color: #e6c3bb;
    background: #f8efec;
  }
  .int-text {
    display: grid;
    gap: 2px;
    margin-right: auto;
    min-width: 0;
  }
  .int-text strong {
    color: #201d1a;
  }
  .int-text span {
    color: #6a6259;
    font-size: 13px;
  }
  .integrity.problems .int-text span,
  .integrity.error .int-text span {
    color: #a33a2a;
  }
  .verify {
    flex: none;
    padding: 8px 14px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fff;
    color: #24211f;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }
  .verify:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .years {
    margin-top: 28px;
  }
  .years h2 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 700;
    color: #4f4942;
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
    color: #6a6259;
    font-size: 14px;
  }
  .track {
    height: 12px;
    border-radius: 6px;
    background: #ece3d6;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 6px;
    background: #24211f;
  }
  .n {
    text-align: right;
    color: #4f4942;
    font-size: 14px;
  }
</style>
