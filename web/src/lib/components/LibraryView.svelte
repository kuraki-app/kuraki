<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { get } from 'svelte/store';
  import { CheckSquare, Grid2X2, Grid3X3, Grid } from '@lucide/svelte';
  import type { Album, Asset, AssetList } from '$lib/types';
  import { api, downloadZip } from '$lib/api';
  import { canMorph, morph } from '$lib/motion';
  import { libraryVersion, showToast } from '$lib/stores';
  import { gridDensity } from '$lib/prefs';
  import AssetGrid from './AssetGrid.svelte';
  import Viewer from './Viewer.svelte';
  import BatchBar from './BatchBar.svelte';
  import AlbumPicker from './AlbumPicker.svelte';
  import PageHeader from './PageHeader.svelte';
  import EmptyState from './EmptyState.svelte';
  import SkeletonGrid from './SkeletonGrid.svelte';
  import { Button } from '$lib/components/ui/button';

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
  let density: 'compact' | 'comfortable' | 'large' = 'comfortable';
  /** The tile the viewer is morphing out of, or back into. Handed to AssetGrid. */
  let morphId: string | null = null;

  const unsub = libraryVersion.subscribe(() => {
    if (mounted) reload();
  });

  onMount(() => {
    mounted = true;
    density = get(gridDensity);
    reload();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
  onDestroy(unsub);

  function msg(e: unknown) {
    return e instanceof Error ? e.message : 'Something went wrong';
  }

  // Svelte's `fade` is WAAPI-driven, not a CSS transition, so the global
  // `prefers-reduced-motion` rule in app.css (which only zeroes CSS
  // animation/transition durations) never reaches it — same matchMedia check
  // `motion.ts` uses, duplicated here since this task must not touch that file.
  // Deliberately plain `fade` here, not `crossfade`/`animate:flip`: those have
  // open Svelte 5 bugs (#10251/#10252) on keyed grid items, which is exactly
  // why the grid morph uses the native View Transitions API instead. This is
  // a container-level swap (skeleton out, grid in), not per-tile, so a plain
  // fade is safe and does not touch AssetGrid's own items.
  function fadeParams() {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduced ? { duration: 0 } : { duration: 240, easing: cubicOut }; // --t-settle
  }
  function setDensity(next: typeof density) {
    density = next;
    gridDensity.set(next);
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
    // viewer pages through the current list. Resolve the list up front: a view
    // transition suppresses rendering until its callback resolves, so awaiting
    // the network inside it would freeze the page mid-morph.
    let next: Asset[];
    let at: number;
    if (asset.stack_size > 1) {
      try {
        const members = (await api.stack(asset.id)).assets;
        next = members.length ? members : [asset];
      } catch {
        next = [asset];
      }
      at = 0;
    } else {
      next = assets;
      at = assets.findIndex((a) => a.id === asset.id);
    }

    // Image-only. A video's tile *does* have a thumbnail, so it would happily
    // take the name — but the viewer renders a <video>, which is not tagged.
    // The group would then hold only an old snapshot and the UA fades that
    // thumbnail out from the tile's old position, in the ::view-transition
    // overlay that paints above the fixed viewer: a ghost over the video.
    if (canMorph(asset)) {
      morphId = asset.id;
      await tick(); // let the tag land on the tile before the old-state snapshot
    }
    await morph(() => {
      viewerAssets = next;
      viewerIndex = at;
      // Cleared *inside* the callback, not after it: the grid stays mounted
      // beneath the viewer, so the tile must drop the name in the same flush
      // that the viewer's image takes it. Two elements holding one
      // view-transition-name at the new-state snapshot aborts the whole
      // transition, silently.
      morphId = null;
    });
    morphId = null; // belt: the fallback path and any aborted transition
  }

  /**
   * The tile id to morph the viewer back into on close, or null to just snap.
   *
   * Closing is the mirror of opening and has two extra ways to have no target.
   * The asset may not be in the grid at all — a stacked tile opens its *members*
   * into the viewer, and none of them but the cover is in `assets`. And the tile
   * may be scrolled out of view after paging or arrow-key navigation. Either way
   * the group would hold only the viewer's old snapshot and orphan-fade it over
   * the grid, which is the Finding-2 ghost again. A correct snap beats that, so
   * the target is confirmed live in the DOM and on screen before we commit.
   */
  function closeMorphTarget(asset: Asset | undefined): string | null {
    if (!asset || !canMorph(asset)) return null; // videos must not morph either
    if (typeof document === 'undefined') return null;
    const tile = document.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`);
    if (!tile) return null; // not in `assets`: stacked member, trashed, archived
    const r = tile.getBoundingClientRect();
    const onScreen =
      r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    return onScreen ? asset.id : null;
  }

  async function closeViewer() {
    const target = closeMorphTarget(viewerAssets[viewerIndex]);
    if (!target) {
      // No tile to morph into. Unlike open() — where withholding morphId also
      // withholds the tile's tag, because the tile's tag is conditional on it —
      // the viewer's <img> tags itself unconditionally. A null target here would
      // still leave the viewer's old snapshot holding the name with nothing on
      // the new side: an old-only group, which the UA animates as a full-screen
      // fade-out over the grid, painted in the ::view-transition overlay above
      // all page content. Bypassing morph() entirely avoids ever starting that
      // transition, so this is a plain, instant state change instead.
      viewerIndex = -1;
      morphId = null;
      return;
    }
    await morph(() => {
      // The exact inverse of open(): the viewer unmounts and drops the name in
      // the same flush that the tile takes it, so each snapshot sees exactly one
      // holder — old: the viewer's img; new: the tile.
      viewerIndex = -1;
      morphId = target;
    });
    morphId = null; // the transition is over; the tile must not keep the name
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

<PageHeader {title} subtitle={subtitle || `${assets.length} ${assets.length === 1 ? 'item' : 'items'}`}>
  <slot name="actions" />
  {#if assets.length > 0}
    <div class="inline-flex rounded-md border border-border" aria-label="Grid density">
      <Button size="icon" variant={density === 'compact' ? 'secondary' : 'ghost'} onclick={() => setDensity('compact')} aria-label="Compact grid"><Grid2X2 size={16} /></Button>
      <Button size="icon" variant={density === 'comfortable' ? 'secondary' : 'ghost'} onclick={() => setDensity('comfortable')} aria-label="Comfortable grid"><Grid3X3 size={16} /></Button>
      <Button size="icon" variant={density === 'large' ? 'secondary' : 'ghost'} onclick={() => setDensity('large')} aria-label="Large grid"><Grid size={16} /></Button>
    </div>
    <Button
      variant={selectMode ? 'default' : 'outline'}
      onclick={() => (selectMode ? clearSel() : (selectMode = true))}
    >
      <CheckSquare size={16} aria-hidden="true" />
      {selectMode ? 'Cancel' : 'Select'}
    </Button>
  {/if}
</PageHeader>

{#if error}
  <div class="grid min-h-[120px] place-items-center gap-3 text-destructive" role="alert"><span>{error}</span><Button variant="outline" onclick={reload}>Try again</Button></div>
{/if}

{#if loading}
  <div out:fade={fadeParams()}>
    <SkeletonGrid {density} />
  </div>
{:else if assets.length === 0}
  <EmptyState title={emptyText} />
{:else}
  <div in:fade={fadeParams()}>
    <AssetGrid
      {assets}
      {selectMode}
      {selected}
      {density}
      {morphId}
      grouped={!trashMode && !albumId}
      on:open={(e) => open(e.detail)}
      on:toggle={(e) => toggle(e.detail)}
    />
  </div>
  {#if cursor}
    <div class="mt-6 flex justify-center">
      <Button variant="outline" disabled={loadingMore} onclick={loadMore}>
        {loadingMore ? 'Loading' : 'Load more'}
      </Button>
    </div>
  {/if}
{/if}

{#if viewerIndex >= 0}
  <Viewer
    assets={viewerAssets}
    index={viewerIndex}
    {trashMode}
    editable={!trashMode}
    on:navigate={(e) => (viewerIndex = e.detail)}
    on:close={closeViewer}
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
