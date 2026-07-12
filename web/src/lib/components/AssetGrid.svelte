<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Star, Play, Check, Layers } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { groupByDay, labelDate } from '$lib/format';

  export let assets: Asset[] = [];
  export let selectMode = false;
  export let selected: Set<string> = new Set();
  export let grouped = true;
  export let density: 'compact' | 'comfortable' | 'large' = 'comfortable';

  const dispatch = createEventDispatcher<{ open: Asset; toggle: string }>();
  $: groups = grouped ? groupByDay(assets) : [{ day: '', items: assets }];
  let loaded = new Set<string>();

  function activate(asset: Asset) {
    if (selectMode) dispatch('toggle', asset.id);
    else dispatch('open', asset);
  }
</script>

<div class="timeline">
  {#each groups as group (group.day)}
    <section class="day">
      {#if grouped && group.day}
        <h2>{labelDate(group.day)}</h2>
      {/if}
      <div class="grid {density}">
        {#each group.items as asset (asset.id)}
          <button
            class="tile"
            class:selected={selected.has(asset.id)}
            type="button"
            on:click={() => activate(asset)}
            aria-label={asset.filename}
          >
            {#if asset.thumbnail_url}
              <span class="shimmer" class:done={loaded.has(asset.id)}></span>
              <img
                class:loaded={loaded.has(asset.id)}
                src={asset.thumbnail_url}
                alt={asset.filename}
                loading="lazy"
                decoding="async"
                on:load={() => (loaded = new Set(loaded).add(asset.id))}
              />
            {:else}
              <span class="ph">{asset.media_type}</span>
            {/if}
            {#if asset.media_type === 'video'}
              <span class="badge play"><Play size={13} fill="currentColor" /></span>
            {/if}
            {#if asset.favorite}
              <span class="badge fav"><Star size={13} fill="currentColor" /></span>
            {/if}
            {#if asset.stack_size > 1}
              <span class="badge stack"><Layers size={12} /> {asset.stack_size}</span>
            {/if}
            {#if selectMode}
              <span class="check" class:on={selected.has(asset.id)}><Check size={13} /></span>
            {/if}
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .timeline {
    display: grid;
    gap: 28px;
  }
  .day {
    display: grid;
    gap: 10px;
  }
  .day h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 8px;
  }
  .grid.compact { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 5px; }
  .grid.large { grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); gap: 12px; }
  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    border-radius: 6px;
    background: var(--thumb);
    color: var(--text-dim);
    cursor: pointer;
    padding: 0;
  }
  .tile.selected {
    outline: 3px solid var(--primary);
    outline-offset: -3px;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .tile img.loaded { opacity: 1; }
  .shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, var(--thumb), color-mix(in srgb, var(--thumb) 72%, white), var(--thumb));
    background-size: 200% 100%;
    animation: shimmer 1.25s infinite;
  }
  .shimmer.done { opacity: 0; transition: opacity 160ms ease; animation: none; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  .tile.selected img {
    transform: scale(0.9);
    border-radius: 4px;
  }
  .ph {
    display: grid;
    place-items: center;
    height: 100%;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 700;
  }
  .badge {
    position: absolute;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #fff8;
    color: #2b2621;
  }
  .fav {
    top: 8px;
    right: 8px;
  }
  .play {
    bottom: 8px;
    left: 8px;
  }
  .stack {
    display: inline-flex;
    align-items: center;
    bottom: 8px;
    right: 8px;
    width: auto;
    height: 22px;
    padding: 0 7px;
    gap: 3px;
    font-size: 11px;
    font-weight: 700;
  }
  .check {
    position: absolute;
    top: 8px;
    left: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 2px solid #fff;
    background: #0006;
    color: transparent;
  }
  .check.on {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  @media (max-width: 780px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
      gap: 6px;
    }
    .grid.large { grid-template-columns: repeat(auto-fill, minmax(144px, 1fr)); }
  }
</style>
