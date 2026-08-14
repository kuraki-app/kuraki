<script lang="ts">
  // An empty list is a first-run screen, not an error, and it is the first
  // thing a new library shows on Albums, Tags, Places and the timeline itself.
  // So it gets four things rather than one sentence: a mark, a title that says
  // what to do, a line explaining what the thing IS, and the action itself.
  //
  // Every call site used to pass a bare `title` and nothing else — the `icon`
  // slot had no consumers anywhere — which is how "No albums yet" ended up
  // alone in 700px of paper with the New album button unmentioned in a corner.
  export let title: string;
  /** Supporting line. Optional, but a title with no explanation is a label. */
  export let body = '';
</script>

<div class="empty">
  <div class="empty-inner">
    <div class="empty-icon"><slot name="icon" /></div>
    <h2 class="empty-title">{title}</h2>
    {#if body}<p class="empty-body">{body}</p>{/if}
    <slot />
    <div class="empty-action"><slot name="action" /></div>
  </div>
</div>

<style>
  .empty {
    display: grid;
    justify-items: center;
    /* Anchored under the content it belongs to, NOT centred in the viewport.
     * Centring pushed the message hundreds of pixels down the page — on Tags it
     * floated well below the "Add tag" form it was talking about, reading as an
     * unrelated notice rather than the state of the list. */
    padding: calc(var(--space-step) * 6) calc(var(--space-step) * 3)
      calc(var(--space-step) * 8);
    color: var(--muted-foreground);
    animation: kuraki-frame-enter var(--frame-duration) var(--frame-ease) both;
  }
  .empty-inner {
    display: grid;
    justify-items: center;
    gap: calc(var(--space-step) * 2);
    max-width: 32rem;
    text-align: center;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: calc(var(--space-step) * 6);
    height: calc(var(--space-step) * 6);
    margin-bottom: var(--space-step);
    border-radius: var(--frame-radius);
    background: var(--muted);
    color: var(--text-faint);
  }
  /* No mark supplied: collapse rather than leave a blank tile sitting there. */
  .empty-icon:empty {
    display: none;
  }
  .empty-title {
    margin: 0;
    color: var(--foreground);
    font-family: var(--frame-title-font);
    font-size: calc(var(--frame-title-size) * 0.72);
    font-weight: var(--frame-title-weight);
    letter-spacing: var(--frame-title-tracking);
  }
  .empty-body {
    margin: 0;
    max-width: 34ch;
    font-size: 14px;
    line-height: 1.55;
  }
  .empty-action {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--space-step) * 2);
    justify-content: center;
    margin-top: calc(var(--space-step) * 2);
  }
  .empty-action:empty {
    display: none;
  }
</style>
