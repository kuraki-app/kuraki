<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Star, Trash2, Download, FolderPlus, FolderMinus, RotateCcw, X, Archive, EyeOff } from '@lucide/svelte';
  import { prefersReducedMotion } from '$lib/motion';

  export let count = 0;
  export let trashMode = false;
  export let albumMode = false;

  const dispatch = createEventDispatcher();

  // This bar is a Kura surface (it acts on photos) — it rises and settles,
  // it does not bounce. --t-settle / --e-kura; cubicOut is the closest JS
  // easing function to the CSS cubic-bezier token (Svelte needs a function).
  function rise() {
    return prefersReducedMotion() ? { duration: 0 } : { y: 32, duration: 240, easing: cubicOut };
  }
</script>

{#if count > 0}
  <div class="bar" role="toolbar" aria-label="Batch actions" transition:fly={rise()}>
    <button class="clear" type="button" on:click={() => dispatch('clear')} aria-label="Clear selection">
      <X size={18} />
    </button>
    <span class="count">{count} selected</span>
    <div class="acts">
      {#if trashMode}
        <button type="button" on:click={() => dispatch('restore')}><RotateCcw size={16} /> Restore</button>
      {:else}
        <button type="button" on:click={() => dispatch('favorite')}><Star size={16} /> Favorite</button>
        <button type="button" on:click={() => dispatch('archive')}><Archive size={16} /> Archive</button>
        <button type="button" on:click={() => dispatch('hide')}><EyeOff size={16} /> Hide</button>
        {#if albumMode}
          <button type="button" on:click={() => dispatch('albumRemove')}><FolderMinus size={16} /> Remove</button>
        {:else}
          <button type="button" on:click={() => dispatch('album')}><FolderPlus size={16} /> Add to album</button>
        {/if}
        <button type="button" on:click={() => dispatch('download')}><Download size={16} /> Download</button>
        <button class="danger" type="button" on:click={() => dispatch('delete')}><Trash2 size={16} /> Delete</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100vw - 24px);
    padding: 8px 8px 8px 12px;
    border-radius: 12px;
    background: var(--chrome);
    color: var(--chrome-text);
    box-shadow: var(--shadow-strong);
    overflow-x: auto;
  }
  .clear {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: var(--chrome-fill-strong);
    color: inherit;
    cursor: pointer;
  }
  .count {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .acts button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: var(--chrome-fill);
    color: var(--chrome-text);
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
  }
  .acts button.danger {
    color: var(--chrome-danger);
  }

  /* Below 820px MobileNav's tab bar owns the bottom edge (~58px, z-index 20).
   * At `bottom: 20px` this bar (z-index 25) paints straight over the primary
   * navigation, so entering select mode would bury it. Same lift, same
   * breakpoint, same idiom as `.uploading` in +layout.svelte, which already
   * solved this exact collision. Desktop is untouched: no tab bar there. */
  @media (max-width: 820px) {
    .bar {
      bottom: calc(70px + env(safe-area-inset-bottom, 0));
      /* Six actions need ~733px; a phone gives ~366. `overflow-x: auto` alone
       * left half of them — Download and Delete included — behind a horizontal
       * scroll with no visible affordance, so on a phone they may as well not
       * exist. Wrap to as many rows as it takes instead: the bar is transient
       * (it only exists in select mode), so spending vertical space on it is
       * cheaper than hiding actions. */
      flex-wrap: wrap;
      overflow-x: visible;
      justify-content: center;
      row-gap: 8px;
      /* Shrink-to-fit plus wrapping collapses the bar to its narrowest column,
       * stacking six actions vertically. Claim the row so they wrap into two or
       * three rows instead. */
      width: calc(100vw - 24px);
    }
    .acts {
      flex: 1 1 100%;
      flex-wrap: wrap;
      justify-content: center;
      row-gap: 6px;
    }
  }
</style>
