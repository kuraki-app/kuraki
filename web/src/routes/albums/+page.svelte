<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Plus, FolderOpen } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { Album } from '$lib/types';

  let albums: Album[] = [];
  let loading = true;

  onMount(load);
  async function load() {
    loading = true;
    try {
      albums = (await api.albums()).albums;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load albums');
    } finally {
      loading = false;
    }
  }
  async function create() {
    const name = prompt('Album name');
    if (!name || !name.trim()) return;
    try {
      const album = await api.createAlbum(name.trim());
      goto(`/albums/${album.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Create failed');
    }
  }
</script>

<header class="head">
  <div>
    <h1>Albums</h1>
    <p>{albums.length} {albums.length === 1 ? 'album' : 'albums'}</p>
  </div>
  <button class="new" type="button" on:click={create}><Plus size={16} /> New album</button>
</header>

{#if loading}
  <div class="grid">{#each Array(6) as _}<div class="card skel"></div>{/each}</div>
{:else if albums.length === 0}
  <div class="empty"><h2>No albums yet</h2></div>
{:else}
  <div class="grid">
    {#each albums as album (album.id)}
      <a class="card" href={`/albums/${album.id}`}>
        <div class="thumb"><FolderOpen size={26} /></div>
        <div class="meta">
          <strong>{album.name}</strong>
          <span>{album.asset_count ?? 0} items</span>
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    margin-bottom: 20px;
  }
  .head > div {
    margin-right: auto;
  }
  .head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }
  .head p {
    margin: 3px 0 0;
    color: #6a6259;
    font-size: 14px;
  }
  .new {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }
  .card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid #e5ddd1;
    border-radius: 12px;
    background: #fffaf3;
    color: #24211f;
    text-decoration: none;
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    border-radius: 8px;
    background: #efe7da;
    color: #8a8175;
  }
  .meta strong {
    display: block;
    overflow-wrap: anywhere;
  }
  .meta span {
    color: #8a8175;
    font-size: 13px;
  }
  .card.skel {
    height: 160px;
    border: 0;
    background: linear-gradient(90deg, #e6ded3, #f9f5ee, #e6ded3);
    background-size: 220% 100%;
    animation: pulse 1.4s infinite;
  }
  .empty {
    display: grid;
    place-items: center;
    min-height: 260px;
    color: #6a6259;
  }
  @keyframes pulse {
    to {
      background-position: -220% 0;
    }
  }
</style>
