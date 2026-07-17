<script lang="ts">
  // Loading placeholder that mirrors the asset grid's shape. AssetGrid is
  // gapless with square, radius-0 tiles (see its `.grid`/`.tile` rules) — a
  // skeleton with a gap or rounded corners implies a layout the real grid
  // never shows, so this must match exactly: no gap, no radius.
  export let count = 18;
  export let density: 'compact' | 'comfortable' | 'large' = 'comfortable';

  const MIN: Record<typeof density, number> = { compact: 96, comfortable: 132, large: 188 };
  $: min = MIN[density];
</script>

<div class="grid" style="grid-template-columns: repeat(auto-fill, minmax({min}px, 1fr))">
  {#each Array(count) as _}
    <div class="aspect-square animate-pulse bg-muted"></div>
  {/each}
</div>
