<script lang="ts">
  // Loading placeholder that mirrors the asset grid's shape.
  export let count = 18;
  export let min = 132;
</script>

<div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax({min}px, 1fr))">
  {#each Array(count) as _}
    <div class="aspect-square animate-pulse rounded-md bg-muted"></div>
  {/each}
</div>
