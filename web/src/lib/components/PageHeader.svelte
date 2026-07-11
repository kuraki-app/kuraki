<script lang="ts">
  // Standard page title block used by every route. Optional right-aligned
  // actions go in the default slot.
  export let title: string;
  export let subtitle = '';
</script>

<header class="mb-5 flex items-center gap-3">
  <div class="mr-auto min-w-0">
    <h1 class="font-heading text-[22px] font-bold tracking-tight">{title}</h1>
    {#if subtitle}<p class="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>{/if}
  </div>
  <slot />
</header>
