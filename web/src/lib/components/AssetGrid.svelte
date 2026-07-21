<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Star, Play, Check, Layers } from '@lucide/svelte';
  import type { Asset } from '$lib/types';
  import { groupByDay, labelDate } from '$lib/format';
  import { MORPH_NAME } from '$lib/motion';

  export let assets: Asset[] = [];
  export let selectMode = false;
  export let selected: Set<string> = new Set();
  export let grouped = true;
  export let density: 'compact' | 'comfortable' | 'large' = 'comfortable';

  /**
   * The asset currently morphing. Exactly one, or the transition aborts.
   * Callers must only ever set this to an asset `canMorph()` accepts — the tag
   * below is a no-op without a thumbnail, but the viewer end is not.
   */
  export let morphId: string | null = null;

  const dispatch = createEventDispatcher<{ open: Asset; toggle: string }>();
  $: groups = grouped ? groupByDay(assets) : [{ day: '', items: assets }];

  // ---- Virtualization (day-group windowing) --------------------------------
  //
  // A large library is thousands of tiles; rendering one DOM node each locks up
  // the browser. Instead each day-group section is materialized only while it is
  // near the viewport (an IntersectionObserver with a tall rootMargin buffer),
  // and replaced by a fixed-height spacer otherwise — so on-screen DOM stays
  // bounded to a few sections regardless of library size.
  //
  // Section granularity (not per-tile) is deliberate: the grid is a responsive
  // `auto-fill` grid whose column count depends on width, so there is no fixed
  // row height to virtualize against. Measuring whole sections sidesteps the
  // column math and keeps the gapless CSS grid, the day grouping, and the morph
  // all working untouched. A materialized section's height is measured and
  // cached so its spacer reserves the exact same space when it later unmounts,
  // keeping scroll position and the scrollbar stable.
  const BUFFER_PX = 1200; // materialize this far outside the viewport, each side
  let containerWidth = 0;
  let visible = new Set<string>(); // day keys currently materialized
  let heights = new Map<string, number>(); // measured section heights, by day

  // Clear cached heights when density changes — the tile size (and thus every
  // section's height) changes, so old measurements would misreserve space.
  let lastDensity = density;
  $: if (density !== lastDensity) {
    lastDensity = density;
    heights = new Map();
  }

  // The section holding the morph target must stay materialized through the
  // transition even if the observer would drop it; a morph into a spacer has no
  // tile. Only computed while a morph is active (rare), so the scan is cheap.
  $: morphDay =
    morphId != null ? (groups.find((g) => g.items.some((a) => a.id === morphId))?.day ?? null) : null;
  $: isLive = (day: string) => visible.has(day) || day === morphDay;

  function estimateHeight(group: { day: string; items: Asset[] }): number {
    const min = density === 'compact' ? 96 : density === 'large' ? 188 : 132;
    const w = containerWidth || 1200;
    const cols = Math.max(1, Math.floor(w / min));
    const tile = w / cols; // tiles are square (aspect-ratio: 1)
    const rows = Math.ceil(group.items.length / cols);
    const header = grouped && group.day ? 35 : 0; // h2 line + its gap
    return rows * tile + header;
  }
  $: heightFor = (group: { day: string; items: Asset[] }): number =>
    heights.get(group.day) ?? estimateHeight(group);

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const e of entries) {
          const day = (e.target as HTMLElement).dataset.day ?? '';
          if (e.isIntersecting) {
            if (!visible.has(day)) {
              visible.add(day);
              changed = true;
            }
          } else if (visible.has(day)) {
            visible.delete(day);
            changed = true;
          }
        }
        if (changed) visible = visible; // reassign to trigger Svelte reactivity
      },
      { rootMargin: `${BUFFER_PX}px 0px` },
    );
  }
  onDestroy(() => observer?.disconnect());

  // observe: registers a section wrapper with the observer. Because sections
  // render top-to-bottom and the observer reports the initial viewport on the
  // next frame, the first screen materializes immediately with no manual seeding.
  function observe(el: HTMLElement) {
    observer?.observe(el);
    return { destroy: () => observer?.unobserve(el) };
  }

  // measure: records a materialized section's real height so its spacer reserves
  // the same space later. Reassigns the map so a re-measure (e.g. after images
  // change intrinsic layout) is picked up by heightFor.
  function measure(el: HTMLElement, day: string) {
    const record = () => {
      const h = el.offsetHeight;
      if (h > 0 && heights.get(day) !== h) {
        heights.set(day, h);
        heights = heights;
      }
    };
    record();
    const ro = new ResizeObserver(record);
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }

  let loaded = new Set<string>();

  function activate(asset: Asset) {
    if (selectMode) dispatch('toggle', asset.id);
    else dispatch('open', asset);
  }
</script>

<div class="timeline" bind:clientWidth={containerWidth}>
  {#each groups as group (group.day)}
    <!-- Each section is always in the DOM (so the observer can watch it and the
         spacer holds scroll height); its contents materialize only when live. -->
    <section
      class="day"
      data-day={group.day}
      use:observe
      style:min-height={isLive(group.day) ? undefined : `${heightFor(group)}px`}
    >
      {#if isLive(group.day)}
        <div class="day-inner" use:measure={group.day}>
          {#if grouped && group.day}
            <h2>{labelDate(group.day)}</h2>
          {/if}
          <div class="grid {density}">
            {#each group.items as asset (asset.id)}
              <!-- data-asset-id lets LibraryView locate a tile before morphing the
                   viewer back into it: the morph target must be rendered and on
                   screen, and only the DOM can answer that. -->
              <button
                class="tile"
                class:selected={selected.has(asset.id)}
                type="button"
                data-asset-id={asset.id}
                on:click={() => activate(asset)}
                aria-label={asset.filename}
              >
                {#if asset.thumbnail_url}
                  <span class="shimmer" class:done={loaded.has(asset.id)}></span>
                  <img
                    class:loaded={loaded.has(asset.id)}
                    style:view-transition-name={morphId === asset.id ? MORPH_NAME : undefined}
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
        </div>
      {/if}
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
    font-size: 15px;
    font-weight: 700;
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 0;
  }
  .grid.compact { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
  .grid.large { grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); }
  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    /* Gapless forces square: rounded corners at zero gap punch diamond-shaped
     * holes at every four-corner junction. Geometry, not preference. */
    border-radius: 0;
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
  @media (max-width: 780px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    }
    .grid.large { grid-template-columns: repeat(auto-fill, minmax(144px, 1fr)); }
  }
</style>
