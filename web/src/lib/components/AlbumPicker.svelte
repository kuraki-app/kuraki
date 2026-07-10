<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Album } from '$lib/types';

  export let albums: Album[] = [];
  const dispatch = createEventDispatcher();
  let name = '';
</script>

<div class="backdrop" role="presentation" on:click|self={() => dispatch('close')}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Add to album">
    <h3>Add to album</h3>
    <div class="list">
      {#each albums as album (album.id)}
        <button type="button" class="row" on:click={() => dispatch('pick', album.id)}>
          <span>{album.name}</span>
          <span class="count">{album.asset_count ?? 0}</span>
        </button>
      {/each}
      {#if albums.length === 0}
        <p class="muted">No albums yet — create one below.</p>
      {/if}
    </div>
    <form on:submit|preventDefault={() => name.trim() && dispatch('create', name.trim())}>
      <input bind:value={name} placeholder="New album name" />
      <button type="submit" disabled={!name.trim()}>Create</button>
    </form>
    <button type="button" class="cancel" on:click={() => dispatch('close')}>Cancel</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 18px;
    background: #0007;
  }
  .modal {
    display: grid;
    gap: 14px;
    width: min(420px, 100%);
    padding: 20px;
    border-radius: 14px;
    background: #fffaf3;
    color: #24211f;
  }
  h3 {
    margin: 0;
    font-size: 18px;
  }
  .list {
    display: grid;
    gap: 6px;
    max-height: 46vh;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid #e2dacd;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    font-size: 15px;
  }
  .count {
    color: #8a8175;
    font-size: 13px;
  }
  .muted {
    margin: 0;
    color: #8a8175;
  }
  form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  input {
    height: 42px;
    padding: 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fff;
    font: inherit;
  }
  form button {
    height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: #fff;
    cursor: pointer;
    font-weight: 700;
  }
  form button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .cancel {
    justify-self: center;
    border: 0;
    background: none;
    color: #6a6259;
    cursor: pointer;
  }
</style>
