<script lang="ts">
  // The heading above a group of related settings or data.
  //
  // Deliberately a component and not a global `[data-register='vault'] h2` rule.
  // Trash and Duplicates are Vault FRAMES hosting a Kura grid, and AssetGrid
  // renders its day headers as <h2> — a register-keyed element selector would
  // restyle those day headers into mono micro-caps and break the one rule the
  // whole system rests on: the register belongs to the page frame, never to the
  // photo components. Opting in explicitly is what keeps that seam intact.
  //
  // In the Vault this renders as clipped, spaced micro-caps; in Kura it stays
  // conversational sans. Both come from the --frame-label-* tokens, so a page
  // that changes register changes this with it and nothing here hardcodes a
  // face or a size.

  /** Right-hand side of the heading row — a count, a status, an action. */
  export let trailing = false;
</script>

<h2 class="section-heading" class:trailing>
  <span><slot /></span>
  {#if trailing}<span class="aside"><slot name="trailing" /></span>{/if}
</h2>

<style>
  .section-heading {
    display: flex;
    align-items: center;
    gap: calc(var(--space-step) * 2);
    margin: 0 0 calc(var(--space-step) * 2);
    color: var(--text-dim);
    font-family: var(--frame-label-font);
    font-size: var(--frame-label-size);
    font-weight: 600;
    letter-spacing: var(--frame-label-tracking);
    text-transform: var(--frame-label-transform);
  }
  .section-heading.trailing {
    justify-content: space-between;
  }
  .aside {
    /* Whatever sits at the end of the row is a readout, not a label. */
    font-family: var(--frame-data-font);
    font-size: 12px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-faint);
  }
</style>
