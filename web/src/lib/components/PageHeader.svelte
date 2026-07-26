<script lang="ts">
  // Standard page title block used by every route. Optional right-aligned
  // actions go in the default slot.
  //
  // Renders in whichever register the host page declares via <main
  // data-register> — the vars below are inherited, never selected on, so no
  // :global() ancestor selector is needed and nothing can be scoped away.
  export let title: string;
  export let subtitle = '';
</script>

<header class="page-header">
  <div class="mr-auto min-w-0">
    <h1 class="page-title">{title}</h1>
    {#if subtitle}<p class="page-subtitle">{subtitle}</p>{/if}
  </div>
  <slot />
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    /* Wrapping is unconditional, not a mobile-only rule. A nowrap header is as
     * wide as its controls at *every* width, so a narrow-but-not-phone viewport
     * — a landscape phone at 844px, a half-screen window — sits above the
     * mobile breakpoint and still overflows sideways. Wrap costs nothing when
     * the row fits, which is the desktop case. */
    flex-wrap: wrap;
    gap: calc(var(--space-step) * 1.5);
    margin-bottom: calc(var(--space-step) * 3);
    animation: kuraki-frame-enter var(--frame-duration) var(--frame-ease) both;
  }
  .page-title {
    margin: 0;
    font-family: var(--frame-title-font);
    font-size: var(--frame-title-size);
    font-weight: var(--frame-title-weight);
    letter-spacing: var(--frame-title-tracking);
    line-height: 1.15;
  }
  .page-subtitle {
    margin-top: calc(var(--space-step) * 0.5);
    color: var(--muted-foreground);
    font-family: var(--frame-label-font);
    font-size: var(--frame-label-size);
    letter-spacing: var(--frame-label-tracking);
    text-transform: var(--frame-label-transform);
  }
  /* Below the sidebar breakpoint the title and its actions cannot share one
   * line. Wrapping is what keeps the header's min-content width off the page:
   * a nowrap header is as wide as its controls, and the layout grid then has no
   * choice but to be at least that wide, pushing the whole page sideways.
   *
   * Only wrapping is imposed here. Which control claims a full row and which
   * ones share is the consuming page's call — this component has no idea what
   * was slotted into it, and stretching everything to 100% turns compact icon
   * groups into full-width slabs. */
  @media (max-width: 820px) {
    .page-header {
      gap: var(--space-step);
      margin-bottom: calc(var(--space-step) * 2);
    }
  }
</style>
