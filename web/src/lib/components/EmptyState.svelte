<script lang="ts">
  // Centered empty/placeholder state. `icon` slot is optional; default slot is
  // supporting text under the title. Inherits its register from the host page.
  export let title: string;
</script>

<div class="empty">
  <div class="empty-inner">
    <slot name="icon" />
    <h2 class="empty-title">{title}</h2>
    <slot />
  </div>
</div>

<style>
  .empty {
    display: grid;
    /* Kura gives an empty shelf room to breathe; the Vault just states it. */
    min-height: calc(var(--space-step) * 30);
    place-items: center;
    color: var(--muted-foreground);
    animation: kuraki-frame-enter var(--frame-duration) var(--frame-ease) both;
  }
  .empty-inner {
    max-width: 24rem;
    padding: 0 calc(var(--space-step) * 3);
    text-align: center;
  }
  .empty-title {
    margin-top: calc(var(--space-step) * 0.5);
    color: var(--foreground);
    font-family: var(--frame-title-font);
    font-size: calc(var(--frame-title-size) * 0.72);
    font-weight: var(--frame-title-weight);
    letter-spacing: var(--frame-title-tracking);
  }
</style>
