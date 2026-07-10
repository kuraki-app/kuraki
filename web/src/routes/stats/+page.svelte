<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize } from '$lib/format';
  import type { LibraryStats } from '$lib/types';

  let stats: LibraryStats | null = null;
  let loading = true;

  onMount(async () => {
    try {
      stats = await api.stats();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      loading = false;
    }
  });

  $: maxYear = stats ? Math.max(1, ...stats.by_year.map((y) => y.count)) : 1;
</script>

<header class="head"><h1>Library</h1></header>

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
  .head h1 {
    margin: 0 0 20px;
    font-size: 22px;
    font-weight: 700;
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
