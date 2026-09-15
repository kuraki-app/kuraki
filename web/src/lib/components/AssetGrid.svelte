<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Heart, Play, Check, Layers } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { groupAssets, type Grouping } from '$lib/format';
  import { gridGeometry, gridWindows } from '$lib/gallery-layout';
  import { thumbSrcset } from '$lib/thumbs';
  import { galleryTokens } from '../../../../shared/gallery-tokens';
  import { MORPH_NAME } from '$lib/motion';

  export let assets: Asset[] = [];
  export let selectMode = false;
  export let selected: Set<string> = new Set();
  export let grouped = true;
  /** How headed sections are cut. `grouped={false}` (album and trash views)
   *  overrides it to a single unheaded section. */
  export let grouping: Grouping = 'day';
  export let density: 'compact' | 'comfortable' | 'large' = 'comfortable';

  /**
   * The asset currently morphing. Exactly one, or the transition aborts.
   * Callers must only ever set this to an asset `canMorph()` accepts — the tag
   * below is a no-op without a thumbnail, but the viewer end is not.
   */
  export let morphId: string | null = null;

  const dispatch = createEventDispatcher<{ open: Asset; toggle: string }>();
  $: effectiveGrouping = grouped ? grouping : 'off';
  $: groups = groupAssets(assets, effectiveGrouping);

  // Windows contain six complete rows, even when a month has thousands of
  // photos. Their height is exact at the current width, so resizing also
  // updates offscreen spacers without waiting for them to mount.
  let containerWidth = 0;
  let viewportWidth = 0;
  let visible = new Set<string>();
  let focused: string | null = null;
  let loaded = new Set<string>();
  let failed = new Set<string>();
  export let hasMore = false;
  const GAP = galleryTokens.mediaGap;
  const TILE_MIN = { compact: 96, comfortable: 132, large: 188 };
  const TILE_MIN_NARROW = { compact: 96, comfortable: 104, large: 144 };
  $: minimum = (viewportWidth && viewportWidth <= 820 ? TILE_MIN_NARROW : TILE_MIN)[density];
  $: geometry = gridGeometry(containerWidth || 1200, minimum, GAP);
  $: sections = groups.map((g) => ({ ...g, windows: gridWindows(g.items, geometry.columns, geometry.tile, GAP) }));

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.window!;
        if (entry.isIntersecting) visible.add(key);
        else visible.delete(key);
      }
      visible = new Set(visible);
    }, { rootMargin: '900px 0px' });
  }
  onDestroy(() => observer?.disconnect());
  function observe(el: HTMLElement) {
    observer?.observe(el);
    return { destroy: () => {
      observer?.unobserve(el);
      visible.delete(el.dataset.window!);
    } };
  }

  function activate(asset: Asset) {
    if (selectMode) dispatch('toggle', asset.id);
    else dispatch('open', asset);
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div class="timeline" bind:clientWidth={containerWidth}>
  {#each sections as group (group.key)}
    <section class="day" data-group={group.key}>
      <div class="day-inner">
        {#if group.label}
          <h2>{group.label}<span>{group.items.length.toLocaleString()}{hasMore && group.key === sections.at(-1)?.key ? '+' : ''}</span></h2>
        {/if}
        <div class="windows">
          {#each group.windows as window (window.items[0].id)}
            {@const key = `${group.key}:${window.items[0].id}`}
            <div data-window={key} use:observe style:min-height={`${window.height}px`}>
              {#if !observer || visible.has(key) || window.items.some((a) => a.id === morphId || a.id === focused)}
                <div class="grid {density}" style:grid-template-columns={`repeat(${geometry.columns}, minmax(0, 1fr))`}>
                  {#each window.items as asset (asset.id)}
                    <button class="tile" class:selected={selected.has(asset.id)} type="button"
                      data-asset-id={asset.id} on:click={() => activate(asset)} aria-label={asset.filename}
                      aria-pressed={selectMode ? selected.has(asset.id) : undefined}
                      on:focus={() => (focused = asset.id)} on:blur={() => (focused = null)}>
                      {#if asset.thumbnail_url && !failed.has(asset.id)}
                        <span class="shimmer" class:done={loaded.has(asset.id)}></span>
                        <img class:loaded={loaded.has(asset.id)}
                          style:view-transition-name={morphId === asset.id ? MORPH_NAME : undefined}
                          src={asset.thumbnail_url} srcset={thumbSrcset(asset)} sizes={`${Math.ceil(geometry.tile)}px`}
                          alt="" loading="lazy" decoding="async"
                          on:load={() => { loaded.add(asset.id); loaded = loaded; }}
                          on:error={() => { failed.add(asset.id); failed = failed; }} />
                      {:else}
                        <span class="ph">{failed.has(asset.id) ? 'Preview unavailable' : asset.media_type}</span>
                      {/if}
                      {#if asset.media_type === 'video'}<span class="badge play"><Play size={13} fill="currentColor" /></span>{/if}
                      {#if asset.favorite}<span class="badge fav"><Heart size={13} fill="currentColor" /></span>{/if}
                      {#if asset.stack_size > 1}<span class="badge stack"><Layers size={12} /> {asset.stack_size}</span>{/if}
                      {#if selectMode}<span class="check" class:on={selected.has(asset.id)}><Check size={13} /></span>{/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </section>
  {/each}
</div>

<style>
  .timeline {
    display: grid;
    gap: 28px;
  }
  /* A plain block so its min-height spacer (set when the section is not live)
   * reserves the measured height. The grid + header gap live on .day-inner. */
  .day-inner {
    display: grid;
    gap: 10px;
  }
  .day h2 {
    margin: 0;
    /* The display face, per the design spec's type table: "Fraunces Variable —
     * display headings, page titles, DAY HEADERS — Kura". It was rendering in
     * the inherited sans, which the spec never called for; the gap only shows
     * up when you put the two faces side by side in a browser.
     *
     * This is the Kura register asserting itself, and it must stay independent
     * of the host page: Trash is a Vault frame, and a day header there is still
     * a date over photographs. */
    font-family: var(--font-heading);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-dim);
  }
  .windows { display: grid; gap: var(--media-gap); }
  .day h2 { display: flex; align-items: baseline; gap: 8px; }
  .day h2 span { font: 400 12px var(--font-sans); color: var(--muted-foreground); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: var(--media-gap);
  }
  .grid.compact { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
  .grid.large { grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); }
  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    border-radius: var(--media-radius);
    background: var(--thumb);
    color: var(--text-dim);
    cursor: pointer;
    padding: 0;
  }
  /* The cell edge and the selection ring are drawn by a positioned overlay,
   * not by the tile's own box-shadow: an element's shadow paints beneath its
   * in-flow children, so an opaque photo would cover it completely. */
  .tile::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06);
  }
  :global(.dark) .tile::after {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
  }
  .tile.selected::after {
    box-shadow: inset 0 0 0 3px var(--stamp);
  }
  /* The global rule uses outline-offset: 2px, which at zero gap draws the ring
   * on top of the neighbouring photos. Inset it so focus is unambiguous.
   * outline paints above everything (including the ::after overlay), so a
   * tile that is both selected and focused shows both affordances at once. */
  .tile:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0;
    /* Opacity only — never scale. At zero gap and zero radius a scale-in
     * overflows into the neighbouring photo. */
    transition: opacity var(--t-settle) var(--e-kura);
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
  /* Selection manufactures its own gap: the sheet is solid, then selected
   * photos recede into their cells. */
  .tile.selected img {
    transform: scale(0.9);
    border-radius: 2px;
    transition: transform var(--t-settle) var(--e-kura), opacity var(--t-settle) var(--e-kura);
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
    /* --t-instant: selection is confirmation, not travel, so the check stamps
     * in at the shortest step on the scale rather than settling like the tile
     * beneath it. No transform — at zero gap a scaling badge would overhang
     * the neighbouring photo. */
    transition:
      background-color var(--t-instant) var(--e-kura),
      color var(--t-instant) var(--e-kura);
  }
  /* --stamp, matching `.tile.selected::after` above: both affordances mark the
   * same tile as selected, so they speak with one colour. --stamp-foreground is
   * the token for a glyph on a stamp fill and is contrast-gated against it by
   * scripts/check-contrast.py. */
  .check.on {
    background: var(--stamp);
    color: var(--stamp-foreground);
  }
  @media (max-width: 820px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .grid.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .grid.large { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
