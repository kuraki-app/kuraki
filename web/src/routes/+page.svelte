<script lang="ts">
  import { onMount } from 'svelte';
  import { Search, X, SlidersHorizontal, CalendarDays, Bookmark, Trash2 } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import FilterChip from '$lib/components/FilterChip.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { api, type SearchParams } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { SavedSearch } from '$lib/types';

  let query = '';
  let type: '' | 'image' | 'video' = '';
  let favorite = false;
  let from = '';
  let to = '';
  let showFilters = false;
  let jumpDate = '';

  // Saved searches: the API (list/create/delete) already exists; this is its UI.
  let saved: SavedSearch[] = [];
  let showSaved = false;
  let saveName = '';

  onMount(loadSaved);

  async function loadSaved() {
    try {
      saved = (await api.savedSearches()).saved_searches;
    } catch {
      /* non-fatal: the timeline still works without the saved list */
    }
  }

  // The applied filter set as a plain string record — the shape the server
  // stores as a saved search's query and hands back on apply.
  function appliedRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied)) if (v != null && v !== '') out[k] = String(v);
    return out;
  }

  async function saveCurrent() {
    const name = saveName.trim();
    if (!name) return;
    try {
      await api.createSavedSearch(name, appliedRecord());
      saveName = '';
      await loadSaved();
      showToast('Search saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save search');
    }
  }

  function applySaved(s: SavedSearch) {
    // The generated type is Record<string, never> (json.RawMessage); the real
    // value is the stored filter record.
    const p = s.query as unknown as SearchParams;
    // Sync the visible form fields for display…
    query = p.q ?? '';
    type = (p.type as '' | 'image' | 'video') ?? '';
    favorite = p.favorite === '1';
    from = p.from ?? '';
    to = p.to ?? '';
    // …but apply the FULL saved query, including filters the form doesn't expose
    // (place_city, camera, rating, tag), so nothing is silently dropped.
    applied = { ...p };
    showSaved = false;
  }

  async function removeSaved(id: string) {
    try {
      await api.deleteSavedSearch(id);
      await loadSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete');
    }
  }

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
  function jumpToDate() {
    if (!jumpDate) return;
    from = jumpDate;
    to = '';
    showFilters = true;
    apply();
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
      <label class="jump">
        <CalendarDays size={16} aria-hidden="true" />
        <input bind:value={jumpDate} type="date" aria-label="Jump to date" on:change={jumpToDate} />
      </label>
      <IconButton
        label="Saved searches"
        variant={showSaved ? 'secondary' : 'outline'}
        onclick={() => (showSaved = !showSaved)}
      >
        <Bookmark size={16} aria-hidden="true" />
      </IconButton>
      {#if filtered}
        <IconButton label="Clear filters" onclick={clearAll}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      {/if}
    </div>
  </LibraryView>
{/key}

{#if showSaved}
  <div class="panel saved">
    {#if filtered}
      <form class="save-current" on:submit|preventDefault={saveCurrent}>
        <input bind:value={saveName} type="text" placeholder="Name this search…" aria-label="Saved search name" />
        <IconButton label="Save current search" variant="secondary" onclick={saveCurrent}>
          <Bookmark size={15} aria-hidden="true" />
        </IconButton>
      </form>
    {:else}
      <p class="hint">Apply a filter or search, then save it here as a smart filter.</p>
    {/if}
    {#if saved.length}
      <ul class="saved-list">
        {#each saved as s (s.id)}
          <li>
            <button type="button" class="apply" on:click={() => applySaved(s)}>{s.name}</button>
            <button type="button" class="del" aria-label={`Delete ${s.name}`} on:click={() => removeSaved(s.id)}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">No saved searches yet.</p>
    {/if}
  </div>
{/if}

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
  .jump {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 38px;
    padding: 0 8px;
    border: 1px solid var(--input);
    border-radius: 8px;
    color: var(--muted-foreground);
    background: var(--card);
  }
  .jump input { width: 122px; border: 0; outline: 0; background: transparent; color: var(--foreground); }
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
  .saved {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .save-current {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .save-current input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
  }
  .saved .hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .saved-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .saved-list li {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--input);
    border-radius: 999px;
    overflow: hidden;
    background: var(--card);
  }
  .saved-list .apply {
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
    font: inherit;
  }
  .saved-list .apply:hover {
    background: var(--muted);
  }
  .saved-list .del {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px 6px 6px;
    border: 0;
    border-left: 1px solid var(--input);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .saved-list .del:hover {
    color: var(--stamp, var(--destructive));
  }
</style>
