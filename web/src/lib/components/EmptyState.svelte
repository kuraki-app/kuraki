<script lang="ts">
  // Centered empty/placeholder state. `icon` slot is optional; default slot is
  // supporting text under the title.
  export let title: string;
</script>

<div class="grid min-h-[260px] place-items-center text-muted-foreground">
  <div class="max-w-sm px-6 text-center">
    <slot name="icon" />
    <h2 class="text-lg font-medium text-foreground">{title}</h2>
    <slot />
  </div>
</div>
