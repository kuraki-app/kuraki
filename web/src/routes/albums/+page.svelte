<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Plus, FolderOpen } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { Album } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PromptDialog from '$lib/components/PromptDialog.svelte';
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
  let createOpen = false;
  let newName = '';
  let creating = false;
  async function create(name: string) {
    creating = true;
    try {
      const album = await api.createAlbum(name);
      createOpen = false;
      newName = '';
      goto(`/albums/${album.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Create failed');
    } finally {
      creating = false;
    }
  }
</script>

<PageHeader title="Albums" subtitle={`${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`}>
  <Button onclick={() => ((newName = ''), (createOpen = true))}>
    <Plus size={16} aria-hidden="true" /> New album
  </Button>
</PageHeader>

{#if loading}
  <div class="grid">{#each Array(6) as _}<div class="h-40 animate-pulse rounded-xl bg-muted"></div>{/each}</div>
{:else if albums.length === 0}
  <EmptyState
    title="Group photos into an album"
    body="An album is only a grouping — a photo can be in as many albums as you like, and it stays in your timeline either way."
  >
    <svelte:fragment slot="icon"><FolderOpen size={20} aria-hidden="true" /></svelte:fragment>
    <svelte:fragment slot="action">
      <Button onclick={() => ((newName = ''), (createOpen = true))}>
        <Plus size={16} aria-hidden="true" /> New album
      </Button>
    </svelte:fragment>
  </EmptyState>
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

<PromptDialog
  bind:open={createOpen}
  bind:value={newName}
  title="New album"
  label="Album name"
  placeholder="e.g. Kyoto, spring"
  confirmLabel="Create"
  busy={creating}
  onsubmit={create}
/>
