<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';

  let query = '';
  let active = '';

  function submit() {
    active = query.trim();
  }
  function clear() {
    query = '';
    active = '';
  }

  $: loader = active ? () => api.search({ q: active }) : (c?: string) => api.assets(c);
</script>

{#key active}
  <LibraryView
    load={loader}
    title={active ? 'Search' : 'Timeline'}
    subtitle={active ? `Results for “${active}”` : ''}
    emptyText={active ? 'No matches found' : 'No photos yet — upload to begin'}
  >
    <form slot="actions" class="search" on:submit|preventDefault={submit}>
      <Search size={16} aria-hidden="true" />
      <input bind:value={query} type="search" placeholder="Search filename, camera, place" />
      {#if active}
        <button type="button" on:click={clear} aria-label="Clear search"><X size={16} /></button>
      {/if}
    </form>
  </LibraryView>
{/key}

<style>
  .search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 6px 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #6a6259;
  }
  .search input {
    width: min(280px, 46vw);
    border: 0;
    outline: 0;
    background: transparent;
    color: #171717;
  }
  .search button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: #ece3d6;
    color: #4f4942;
    cursor: pointer;
  }
</style>
