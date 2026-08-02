<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { Check, X } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { api } from '$lib/api';
  import { Button } from '$lib/components/ui/button';

  /**
   * AlbumPhotoPicker adds photos to an album from inside the album.
   *
   * The only route into an album used to be the other direction — select in the
   * timeline, then choose a target album — which is no help when you are
   * looking at the album and know what is missing from it.
   *
   * Adding is idempotent server-side (`INSERT OR IGNORE`, owner-scoped), so
   * anything already in the album costs nothing; the response's `added` count
   * is what actually changed. Those assets are still shown as ticked and are
   * not selectable, because offering them as new would misreport the album.
   */

  /** Ids already in the album. */
  export let existing: Set<string> = new Set();

  const dispatch = createEventDispatcher<{ close: void; add: string[] }>();

  let assets: Asset[] = [];
  let loading = true;
  let loadingMore = false;
  let cursor = '';
  let error = '';
  let selected = new Set<string>();
  let saving = false;

  onMount(async () => {
    try {
      const res = await api.search({}, undefined);
      assets = res.assets;
      cursor = res.next_cursor ?? '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load your library.';
    } finally {
      loading = false;
    }
  });

  // The library is paged, so a picker that stopped at the first page would put
  // most of a real library out of reach of the one action this dialog exists
  // for.
  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const res = await api.search({}, cursor);
      assets = [...assets, ...res.assets];
      cursor = res.next_cursor ?? '';
    } catch {
      // Keep what is already shown; the button stays available to retry.
    } finally {
      loadingMore = false;
    }
  }

  function toggle(id: string) {
    if (existing.has(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function confirm() {
    if (selected.size === 0 || saving) return;
    saving = true;
    dispatch('add', [...selected]);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="backdrop" role="presentation" on:click|self={() => dispatch('close')}>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Add photos to album">
    <header>
      <button class="icon" type="button" on:click={() => dispatch('close')} aria-label="Close">
        <X size={18} />
      </button>
      <h2>{selected.size > 0 ? `${selected.size} selected` : 'Add photos'}</h2>
      <Button disabled={selected.size === 0 || saving} onclick={confirm}>
        {saving ? 'Adding' : 'Add'}
      </Button>
    </header>

    {#if error}
      <p class="msg" role="alert">{error}</p>
    {:else if loading}
      <p class="msg">Loading your library…</p>
    {:else if assets.length === 0}
      <p class="msg">Nothing in your library yet.</p>
    {:else}
      <div class="grid">
        {#each assets as asset (asset.id)}
          {@const already = existing.has(asset.id)}
          <button
            class="tile"
            class:on={already || selected.has(asset.id)}
            class:already
            type="button"
            disabled={already}
            aria-pressed={already || selected.has(asset.id)}
            aria-label={already ? `${asset.filename} (already in this album)` : asset.filename}
            on:click={() => toggle(asset.id)}
          >
            {#if asset.thumbnail_url}
              <img src={asset.thumbnail_url} alt="" loading="lazy" decoding="async" />
            {/if}
            {#if already || selected.has(asset.id)}
              <span class="check"><Check size={13} /></span>
            {/if}
          </button>
        {/each}
      </div>
      {#if cursor}
        <div class="more">
          <Button variant="outline" disabled={loadingMore} onclick={loadMore}>
            {loadingMore ? 'Loading' : 'Load more'}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(0 0 0 / 0.45);
  }
  .panel {
    display: flex;
    flex-direction: column;
    width: min(900px, 100%);
    max-height: min(720px, 90vh);
    border: 1px solid var(--border);
    border-radius: var(--frame-radius);
    background: var(--background);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  header h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .more {
    display: flex;
    justify-content: center;
    padding: 12px;
    border-top: 1px solid var(--border);
  }
  .msg {
    padding: 32px;
    text-align: center;
    color: var(--muted-foreground);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
    gap: 0;
    overflow-y: auto;
    padding: 0;
  }
  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: var(--thumb);
    cursor: pointer;
  }
  /* Matches the timeline: at zero gap a rounded or scaling tile punches holes
   * into its neighbours, so selection is drawn by an inset overlay instead. */
  .tile::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06);
  }
  .tile.on::after {
    box-shadow: inset 0 0 0 3px var(--stamp);
  }
  /* Already in the album: visibly accounted for, and not offered again. */
  .tile.already {
    cursor: default;
  }
  .tile.already img {
    opacity: 0.45;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tile:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .check {
    position: absolute;
    top: 6px;
    left: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 2px solid #fff;
    background: var(--stamp);
    color: var(--stamp-foreground);
  }
</style>
