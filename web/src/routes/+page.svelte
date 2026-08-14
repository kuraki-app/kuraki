<script lang="ts">
  import { onMount } from 'svelte';
  import { Search, X, SlidersHorizontal, CalendarDays, Bookmark, Trash2, Images, Upload } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import FilterChip from '$lib/components/FilterChip.svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api, type SearchParams } from '$lib/api';
  import { requestUpload, showToast } from '$lib/stores';
  import type { Album, SavedSearch, Tag } from '$lib/types';
  import { page } from '$app/stores';

  let query = '';
  let type: '' | 'image' | 'video' = '';
  let favorite = false;
  let from = '';
  let to = '';
  const MEDIA_TYPES = [
    { value: '' as const, label: 'All' },
    { value: 'image' as const, label: 'Photos' },
    { value: 'video' as const, label: 'Videos' }
  ];

  let showFilters = false;
  let jumpDate = '';
  // The rest of the server's filter language. `parseAssetFilters` has always
  // accepted these; the form exposed q/type/favorite/from/to and nothing else,
  // so a saved search could carry a filter the UI could neither show nor build.
  let camera = '';
  let rating = '';
  let placeCity = '';
  let placeCountry = '';
  let tagId = '';
  let albumId = '';

  // Populated for the tag and album pickers. Both endpoints are already used
  // elsewhere in the app; failing to load them must not break the filter panel.
  let tags: Tag[] = [];
  let albumList: Album[] = [];

  // Saved searches: the API (list/create/delete) already exists; this is its UI.
  let saved: SavedSearch[] = [];
  let showSaved = false;
  let saveName = '';

  onMount(() => {
    loadSaved();
    loadFilterSources();
    applyURLFilters();
  });

  async function loadSaved() {
    try {
      saved = (await api.savedSearches()).saved_searches;
    } catch {
      /* non-fatal: the timeline still works without the saved list */
    }
  }

  async function loadFilterSources() {
    try {
      [tags, albumList] = await Promise.all([
        api.tags().then((r) => r.tags),
        api.albums().then((r) => r.albums)
      ]);
    } catch {
      /* non-fatal: the other filters still work without these two pickers */
    }
  }

  /** Reads filters out of the query string so other pages can link INTO a
   *  filtered timeline — Places sends `?place_city=…&place_country=…`, which is
   *  what the mobile client has always done by tapping a place. */
  function applyURLFilters() {
    const params = $page.url.searchParams;
    const incoming: SearchParams = {};
    for (const key of [
      'q',
      'type',
      'favorite',
      'from',
      'to',
      'camera',
      'rating',
      'place_city',
      'place_country',
      'tag',
      'album'
    ] as const) {
      const value = params.get(key);
      if (value) incoming[key] = value;
    }
    if (Object.keys(incoming).length === 0) return;

    query = incoming.q ?? '';
    type = (incoming.type as '' | 'image' | 'video') ?? '';
    favorite = incoming.favorite === '1';
    from = incoming.from ?? '';
    to = incoming.to ?? '';
    camera = incoming.camera ?? '';
    rating = incoming.rating ?? '';
    placeCity = incoming.place_city ?? '';
    placeCountry = incoming.place_country ?? '';
    tagId = incoming.tag ?? '';
    albumId = incoming.album ?? '';
    applied = incoming;
    showFilters = true;
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
    camera = p.camera ?? '';
    rating = p.rating ?? '';
    placeCity = p.place_city ?? '';
    placeCountry = p.place_country ?? '';
    tagId = p.tag ?? '';
    albumId = p.album ?? '';
    // The form now shows every filter the server understands, so a saved search
    // no longer carries anything the panel cannot display or clear. The full
    // query is still applied wholesale rather than rebuilt from the fields.
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

  // Any non-empty value means a filter is active. Derived from all of applied's
  // values (not a hand-listed subset) so a saved search carrying a filter the
  // form doesn't expose — place, tag, camera, rating — still routes through
  // api.search rather than silently loading the unfiltered timeline.
  $: filtered = Object.values(applied).some((v) => v !== undefined && v !== null && v !== '');

  function apply() {
    applied = {
      q: query.trim() || undefined,
      type: type || undefined,
      favorite: favorite ? '1' : undefined,
      from: from || undefined,
      to: to || undefined,
      camera: camera.trim() || undefined,
      rating: rating || undefined,
      place_city: placeCity.trim() || undefined,
      place_country: placeCountry.trim() || undefined,
      tag: tagId || undefined,
      album: albumId || undefined
    };
  }
  function clearAll() {
    query = '';
    type = '';
    favorite = false;
    from = '';
    to = '';
    camera = '';
    rating = '';
    placeCity = '';
    placeCountry = '';
    tagId = '';
    albumId = '';
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
    if (p.camera) parts.push(p.camera);
    if (p.rating) parts.push(`${p.rating}★ and up`);
    if (p.place_city || p.place_country) {
      parts.push([p.place_city, p.place_country].filter(Boolean).join(', '));
    }
    if (p.tag) parts.push(tags.find((t) => t.id === p.tag)?.name ?? 'tag');
    if (p.album) parts.push(albumList.find((a) => a.id === p.album)?.name ?? 'album');
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
    emptyText={filtered ? 'No photos match these filters' : 'Bring your photos home'}
    emptyBody={filtered
      ? 'Try a wider date range, or clear the filters to see the whole library.'
      : 'Drop files anywhere on this page, or choose Upload. Originals are copied in and never modified after import.'}
  >
    <svelte:fragment slot="empty-icon">
      {#if filtered}<Search size={20} aria-hidden="true" />{:else}<Images size={20} aria-hidden="true" />{/if}
    </svelte:fragment>
    <svelte:fragment slot="empty-action">
      {#if filtered}
        <Button variant="outline" onclick={clearAll}>Clear filters</Button>
      {:else}
        <Button onclick={requestUpload}>
          <Upload size={16} aria-hidden="true" /> Upload photos
        </Button>
      {/if}
    </svelte:fragment>
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
    <!-- Media type is three mutually exclusive options, so it is a segmented
         control. Favorites is an independent toggle and stays a chip — the two
         were built from the same pill and read as one row of four equal
         choices, which is not what they are. -->
    <SegmentedControl
      label="Media type"
      options={MEDIA_TYPES}
      value={type}
      onchange={(v) => { type = v; apply(); }}
    />
    <div class="chips">
      <FilterChip active={favorite} onclick={() => { favorite = !favorite; apply(); }}>Favorites</FilterChip>
    </div>
    <!-- Explicit for/id throughout rather than wrapping labels. A <label> that
         wraps a <select> takes the option text into its own accessible name, so
         "Rating" ends up announced as "Rating Any 1★ and up 2★ and up …" — the
         control is labelled, but not with anything a person would recognise. -->
    <div class="field">
      <label for="filter-from">From</label>
      <input id="filter-from" type="date" bind:value={from} on:change={apply} />
    </div>
    <div class="field">
      <label for="filter-to">To</label>
      <input id="filter-to" type="date" bind:value={to} on:change={apply} />
    </div>

    <!-- Everything below reaches filters the server has always accepted through
         `parseAssetFilters` and that the timeline had no way to express. -->
    <div class="field">
      <label for="filter-rating">Rating</label>
      <select id="filter-rating" bind:value={rating} on:change={apply}>
        <option value="">Any</option>
        <option value="1">1★ and up</option>
        <option value="2">2★ and up</option>
        <option value="3">3★ and up</option>
        <option value="4">4★ and up</option>
        <option value="5">5★</option>
      </select>
    </div>

    <div class="field">
      <label for="filter-camera">Camera</label>
      <input id="filter-camera" type="text" bind:value={camera} placeholder="e.g. iPhone 15" on:change={apply} />
    </div>

    <div class="field">
      <label for="filter-city">City</label>
      <input id="filter-city" type="text" bind:value={placeCity} placeholder="e.g. Kyoto" on:change={apply} />
    </div>

    <div class="field">
      <label for="filter-country">Country</label>
      <input id="filter-country" type="text" bind:value={placeCountry} placeholder="e.g. Japan" on:change={apply} />
    </div>

    {#if tags.length}
      <div class="field">
      <label for="filter-tag">Tag</label>
        <select id="filter-tag" bind:value={tagId} on:change={apply}>
          <option value="">Any</option>
          {#each tags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
    </div>
    {/if}
    {#if albumList.length}
      <div class="field">
      <label for="filter-album">Album</label>
        <select id="filter-album" bind:value={albumId} on:change={apply}>
          <option value="">Any</option>
          {#each albumList as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
    </div>
    {/if}
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
    height: 40px;
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
    height: 40px;
    padding: 0 8px;
    border: 1px solid var(--input);
    border-radius: 8px;
    color: var(--muted-foreground);
    background: var(--card);
  }
  .jump input { width: 122px; border: 0; outline: 0; background: transparent; color: var(--foreground); }
  /* On a phone the search field earns its own full-width row and the icon
   * controls sit under it, rather than four controls fighting over 390px.
   * Fixed widths become flexible ones so nothing here can set a min-content
   * floor wider than the screen. */
  @media (max-width: 820px) {
    .filters {
      display: flex;
      flex-wrap: nowrap;
      /* Own row, below the title/Select line (order 1 puts it after the
       * default-order Select button that shares row one with the title). */
      flex: 1 1 100%;
      order: 1;
    }
    /* Search shares that row with the icon buttons rather than claiming one of
     * its own. The header used to stack four control rows — title, search,
     * filters, density — and eat ~24% of a 390x844 screen before a single
     * photograph. */
    .search {
      flex: 1 1 auto;
      min-width: 0;
    }
    .search input { width: 100%; min-width: 0; }
    /* Jump-to-date folds into the Filters panel on a phone, which already has
     * From and To. A bare `dd/mm/yyyy` field reads as a form to fill in, not as
     * a way to jump — and it was costing a full row to say so. */
    .jump {
      display: none;
    }
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
  /* Label and control travel together. The panel is a wrap row, and with the
   * label as a bare sibling a break could land between them — which is how
   * "City" ended up at the end of one line with its input on the next. */
  .field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .panel label {
    display: inline-flex;
    align-items: center;
    /* The control is now a sibling rather than a child, so the gap that used to
     * separate them inside the label lives on the flex row instead. */
    font-size: 13px;
    color: var(--muted-foreground);
    margin-left: 4px;
  }
  /* One control treatment for every filter input, so the panel reads as one
   * row of controls rather than dates styled apart from the rest. */
  .panel input[type='date'],
  .panel input[type='text'],
  .panel select {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
  }
  .panel input[type='text'] {
    width: 140px;
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
    color: var(--destructive);
  }
</style>
