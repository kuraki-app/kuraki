<script lang="ts">
  // Reserve the same gaps and corners as the gallery during loading.
  export let count = 18;
  export let density: 'compact' | 'comfortable' | 'large' = 'comfortable';

  const MIN: Record<typeof density, number> = { compact: 96, comfortable: 132, large: 188 };
  $: min = MIN[density];
</script>

<div class="grid" style:gap="var(--media-gap)" style="grid-template-columns: repeat(auto-fill, minmax({min}px, 1fr))">
  {#each Array(count) as _}
    <div class="aspect-square animate-pulse bg-muted" style:border-radius="var(--media-radius)"></div>
  {/each}
</div>
