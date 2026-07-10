<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { CheckSquare } from '@lucide/svelte';
  import type { Album, Asset, AssetList } from '$lib/types';
  import { api, downloadZip } from '$lib/api';
  import { libraryVersion, showToast } from '$lib/stores';
  import AssetGrid from './AssetGrid.svelte';
  import Viewer from './Viewer.svelte';
  import BatchBar from './BatchBar.svelte';
  import AlbumPicker from './AlbumPicker.svelte';

  export let load: (cursor?: string) => Promise<AssetList>;
  export let title = '';
  export let subtitle = '';
  export let trashMode = false;
  export let albumId: string | null = null;
  export let favoritesMode = false;
  export let emptyText = 'Nothing here yet';

  let assets: Asset[] = [];
  let cursor = '';
  let loading = true;
  let loadingMore = false;
  let error = '';
  let selectMode = false;
  let selected = new Set<string>();
  let viewerAssets: Asset[] = [];
  let viewerIndex = -1;
  let pickerOpen = false;
  let albums: Album[] = [];
  let mounted = false;

  const unsub = libraryVersion.subscribe(() => {
    if (mounted) reload();
  });

  onMount(() => {
    mounted = true;
    reload();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
  onDestroy(unsub);

  function msg(e: unknown) {
    return e instanceof Error ? e.message : 'Something went wrong';
  }

  async function reload() {
    loading = true;
    error = '';
    try {
      const data = await load();
      assets = data.assets;
      cursor = data.next_cursor ?? '';
    } catch (e) {
      error = msg(e);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (loadingMore || !cursor) return;
    loadingMore = true;
    try {
      const data = await load(cursor);
      assets = [...assets, ...data.assets];
      cursor = data.next_cursor ?? '';
    } catch (e) {
      showToast(msg(e));
    } finally {
      loadingMore = false;
    }
  }

  function onScroll() {
    if (loadingMore || !cursor || viewerIndex >= 0) return;
    const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    if (remaining < 900) loadMore();
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }
  function clearSel() {
    selected = new Set();
    selectMode = false;
  }

  async function open(asset: Asset) {
    // A stacked tile opens its members (RAW+JPEG / Live Photo); otherwise the
    // viewer pages through the current list.
    if (asset.stack_size > 1) {
      try {
        const members = (await api.stack(asset.id)).assets;
        viewerAssets = members.length ? members : [asset];
      } catch {
        viewerAssets = [asset];
      }
      viewerIndex = 0;
    } else {
      viewerAssets = assets;
      viewerIndex = assets.findIndex((a) => a.id === asset.id);
    }
  }

  function dropAsset(id: string) {
    assets = assets.filter((a) => a.id !== id);
    viewerAssets = viewerAssets.filter((a) => a.id !== id);
    if (viewerIndex >= 0) {
      if (viewerAssets.length === 0) viewerIndex = -1;
      else if (viewerIndex >= viewerAssets.length) viewerIndex = viewerAssets.length - 1;
    }
  }

  async function favoriteOne(asset: Asset) {
    const next = !asset.favorite;
    try {
      await api.setFavorite(asset.id, next);
      if (favoritesMode && !next) {
        dropAsset(asset.id);
      } else {
        const apply = (a: Asset) => (a.id === asset.id ? { ...a, favorite: next } : a);
        assets = assets.map(apply);
        viewerAssets = viewerAssets.map(apply);
      }
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function patchOne(patch: Record<string, unknown>) {
    const { id, ...rest } = patch as { id: string };
    try {
      const updated = await api.patchAsset(id, rest);
      assets = assets.map((a) => (a.id === updated.id ? updated : a));
      viewerAssets = viewerAssets.map((a) => (a.id === updated.id ? updated : a));
      showToast('Updated');
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function removeOne(asset: Asset) {
    try {
      await api.remove(asset.id);
      dropAsset(asset.id);
      showToast('Moved to trash');
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function restoreOne(asset: Asset) {
    try {
      await api.restore(asset.id);
      dropAsset(asset.id);
      showToast('Restored');
    } catch (e) {
      showToast(msg(e));
    }
  }

  function markFavorite(ids: string[]) {
    const set = new Set(ids);
    assets = assets.map((a) => (set.has(a.id) ? { ...a, favorite: true } : a));
  }
  function removeMany(ids: string[]) {
    const set = new Set(ids);
    assets = assets.filter((a) => !set.has(a.id));
  }

  async function batch(action: () => Promise<unknown>, after: () => void, note: string) {
    const ids = [...selected];
    try {
      await action();
      after();
      clearSel();
      showToast(note.replace('{n}', String(ids.length)));
    } catch (e) {
      showToast(msg(e));
    }
  }

  const batchFavorite = () =>
    batch(() => api.batch('favorite', [...selected]), () => markFavorite([...selected]), 'Favorited {n}');
  const batchDelete = () =>
    batch(() => api.batch('delete', [...selected]), () => removeMany([...selected]), 'Moved {n} to trash');
  const batchRestore = () =>
    batch(() => api.batch('restore', [...selected]), () => removeMany([...selected]), 'Restored {n}');
  const batchArchive = () =>
    batch(() => api.batch('archive', [...selected]), () => removeMany([...selected]), 'Archived {n}');
  const batchHide = () =>
    batch(() => api.batch('hide', [...selected]), () => removeMany([...selected]), 'Hidden {n}');
  const batchRemoveFromAlbum = () =>
    albumId &&
    batch(() => api.removeFromAlbum(albumId!, [...selected]), () => removeMany([...selected]), 'Removed {n}');

  async function batchDownload() {
    try {
      await downloadZip([...selected]);
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function openPicker() {
    try {
      albums = (await api.albums()).albums;
      pickerOpen = true;
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function addToAlbum(id: string) {
    pickerOpen = false;
    const ids = [...selected];
    try {
      await api.addToAlbum(id, ids);
      clearSel();
      showToast(`Added ${ids.length} to album`);
    } catch (e) {
      showToast(msg(e));
    }
  }
  async function createAlbumThenAdd(name: string) {
    try {
      const album = await api.createAlbum(name);
      await addToAlbum(album.id);
    } catch (e) {
      showToast(msg(e));
    }
  }
</script>

<header class="head">
  <div>
    {#if title}<h1>{title}</h1>{/if}
    <p>{subtitle || `${assets.length} ${assets.length === 1 ? 'item' : 'items'}`}</p>
  </div>
  <slot name="actions" />
  {#if assets.length > 0}
    <button class="select" type="button" class:on={selectMode} on:click={() => (selectMode ? clearSel() : (selectMode = true))}>
      <CheckSquare size={16} />
      {selectMode ? 'Cancel' : 'Select'}
    </button>
  {/if}
</header>

{#if error}
  <div class="notice">{error}</div>
{/if}

{#if loading}
  <div class="grid skeleton">
    {#each Array(18) as _}<div></div>{/each}
  </div>
{:else if assets.length === 0}
  <div class="empty"><h2>{emptyText}</h2></div>
{:else}
  <AssetGrid
    {assets}
    {selectMode}
    {selected}
    grouped={!trashMode && !albumId}
    on:open={(e) => open(e.detail)}
    on:toggle={(e) => toggle(e.detail)}
  />
  {#if cursor}
    <button class="more" type="button" disabled={loadingMore} on:click={loadMore}>
      {loadingMore ? 'Loading' : 'Load more'}
    </button>
  {/if}
{/if}

{#if viewerIndex >= 0}
  <Viewer
    assets={viewerAssets}
    index={viewerIndex}
    {trashMode}
    editable={!trashMode}
    on:navigate={(e) => (viewerIndex = e.detail)}
    on:close={() => (viewerIndex = -1)}
    on:favorite={(e) => favoriteOne(e.detail)}
    on:remove={(e) => removeOne(e.detail)}
    on:restore={(e) => restoreOne(e.detail)}
    on:patch={(e) => patchOne(e.detail)}
  />
{/if}

<BatchBar
  count={selected.size}
  {trashMode}
  albumMode={!!albumId}
  on:clear={clearSel}
  on:favorite={batchFavorite}
  on:delete={batchDelete}
  on:restore={batchRestore}
  on:archive={batchArchive}
  on:hide={batchHide}
  on:download={batchDownload}
  on:album={openPicker}
  on:albumRemove={batchRemoveFromAlbum}
/>

{#if pickerOpen}
  <AlbumPicker
    {albums}
    on:pick={(e) => addToAlbum(e.detail)}
    on:create={(e) => createAlbumThenAdd(e.detail)}
    on:close={() => (pickerOpen = false)}
  />
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
    font-size: 22px;
    font-weight: 700;
  }
  .head p {
    margin: 3px 0 0;
    color: #6a6259;
    font-size: 14px;
  }
  .head > div {
    margin-right: auto;
  }
  .select {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 14px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #24211f;
    cursor: pointer;
    font-weight: 600;
  }
  .select.on {
    background: #24211f;
    color: #fff;
    border-color: #24211f;
  }
  .notice {
    display: grid;
    place-items: center;
    min-height: 120px;
    color: #a33a2a;
  }
  .empty {
    display: grid;
    place-items: center;
    min-height: 260px;
    color: #6a6259;
  }
  .grid.skeleton {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 8px;
  }
  .skeleton div {
    aspect-ratio: 1;
    border-radius: 6px;
    background: linear-gradient(90deg, #e6ded3, #f9f5ee, #e6ded3);
    background-size: 220% 100%;
    animation: pulse 1.4s infinite;
  }
  .more {
    display: block;
    min-width: 140px;
    height: 42px;
    margin: 26px auto 0;
    border: 1px solid #cfc5b8;
    border-radius: 8px;
    background: #fffaf3;
    color: #24211f;
    cursor: pointer;
  }
  @keyframes pulse {
    to {
      background-position: -220% 0;
    }
  }
</style>
