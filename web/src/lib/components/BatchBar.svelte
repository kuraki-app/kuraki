<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Star, Trash2, Download, FolderPlus, FolderMinus, RotateCcw, X, Archive, EyeOff } from '@lucide/svelte';

  export let count = 0;
  export let trashMode = false;
  export let albumMode = false;

  const dispatch = createEventDispatcher();
</script>

{#if count > 0}
  <div class="bar" role="toolbar" aria-label="Batch actions">
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
</style>
