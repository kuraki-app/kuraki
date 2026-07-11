<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Plus, FolderOpen } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { Album } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';

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

<PageHeader title="Albums" subtitle={`${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`}>
  <Button onclick={create}><Plus size={16} aria-hidden="true" /> New album</Button>
</PageHeader>

{#if loading}
  <div class="grid">{#each Array(6) as _}<div class="h-40 animate-pulse rounded-xl bg-muted"></div>{/each}</div>
{:else if albums.length === 0}
  <EmptyState title="No albums yet" />
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }
  .card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
    color: var(--foreground);
    text-decoration: none;
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    border-radius: 8px;
    background: var(--accent);
    color: var(--text-faint);
  }
  .meta strong {
    display: block;
    overflow-wrap: anywhere;
  }
  .meta span {
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
