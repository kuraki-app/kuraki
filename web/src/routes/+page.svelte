<script lang="ts">
  import { Search, X, SlidersHorizontal } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import FilterChip from '$lib/components/FilterChip.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { api, type SearchParams } from '$lib/api';

  let query = '';
  let type: '' | 'image' | 'video' = '';
  let favorite = false;
  let from = '';
  let to = '';
  let showFilters = false;

  // The applied filter set. A new object identity re-keys LibraryView so it
  // reloads from the first page whenever the filter changes.
  let applied: SearchParams = {};

  $: filtered =
    !!applied.q || !!applied.type || applied.favorite === '1' || !!applied.from || !!applied.to;

  function apply() {
    applied = {
      q: query.trim() || undefined,
      type: type || undefined,
      favorite: favorite ? '1' : undefined,
      from: from || undefined,
      to: to || undefined
    };
  }
  function clearAll() {
    query = '';
    type = '';
    favorite = false;
    from = '';
    to = '';
    applied = {};
  }

  function summary(p: SearchParams): string {
    const parts: string[] = [];
    if (p.q) parts.push(`“${p.q}”`);
    if (p.type) parts.push(p.type === 'image' ? 'photos' : 'videos');
    if (p.favorite === '1') parts.push('favorites');
    if (p.from || p.to) parts.push(`${p.from ?? '…'} – ${p.to ?? '…'}`);
    return parts.length ? `Filtered by ${parts.join(', ')}` : 'All results';
  }

  $: loader = filtered
    ? (c?: string) => api.search(applied, c)
    : (c?: string) => api.assets(c);
</script>

{#key JSON.stringify(applied)}
  <LibraryView
    load={loader}
    title={filtered ? 'Search' : 'Timeline'}
    subtitle={filtered ? summary(applied) : ''}
    emptyText={filtered ? 'No matches found' : 'No photos yet — upload to begin'}
  >
    <div slot="actions" class="filters">
      <form class="search" on:submit|preventDefault={apply}>
        <Search size={16} aria-hidden="true" />
        <input bind:value={query} type="search" placeholder="Search filename, camera, place" aria-label="Search" />
      </form>
      <IconButton
        label="Filters"
        variant={showFilters ? 'secondary' : 'outline'}
        onclick={() => (showFilters = !showFilters)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
      </IconButton>
      {#if filtered}
        <IconButton label="Clear filters" onclick={clearAll}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      {/if}
    </div>
  </LibraryView>
{/key}

{#if showFilters}
  <div class="panel">
    <div class="chips">
      <FilterChip active={type === ''} onclick={() => { type = ''; apply(); }}>All</FilterChip>
      <FilterChip active={type === 'image'} onclick={() => { type = 'image'; apply(); }}>Photos</FilterChip>
      <FilterChip active={type === 'video'} onclick={() => { type = 'video'; apply(); }}>Videos</FilterChip>
      <FilterChip active={favorite} onclick={() => { favorite = !favorite; apply(); }}>Favorites</FilterChip>
    </div>
    <label>From <input type="date" bind:value={from} on:change={apply} /></label>
    <label>To <input type="date" bind:value={to} on:change={apply} /></label>
  </div>
{/if}

<style>
  .filters {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--muted-foreground);
  }
  .search input {
    width: min(260px, 42vw);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--foreground);
  }
  .panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: -8px 0 18px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
  }
  .chips {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .panel label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .panel input[type='date'] {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
  }
</style>
