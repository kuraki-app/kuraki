<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, Lock, LogOut, Search, Star, X } from '@lucide/svelte';

  type Asset = {
    id: string;
    filename: string;
    mime_type: string;
    media_type: 'image' | 'video';
    width: number;
    height: number;
    size_bytes: number;
    taken_at?: string;
    taken_day?: string;
    taken_month?: string;
    camera_make: string;
    camera_model: string;
    gps_lat?: number;
    gps_lon?: number;
    duration_ms: number;
    favorite: boolean;
    original_url: string;
    thumbnail_url?: string;
    created_at: string;
  };

  type AssetList = {
    assets: Asset[];
    next_cursor?: string;
  };

  type User = {
    id: string;
    username: string;
  };

  type SetupStatus = {
    setup_required: boolean;
    user?: User;
  };

  const windowSize = 160;

  let assets: Asset[] = [];
  let nextCursor = '';
  let visibleCount = windowSize;
  let query = '';
  let loading = false;
  let loadingMore = false;
  let error = '';
  let selected: Asset | null = null;
  let selectedImageLoaded = false;

  let checkingSession = true;
  let setupRequired = false;
  let user: User | null = null;
  let authMode: 'setup' | 'login' = 'login';
  let username = 'owner';
  let password = '';
  let authBusy = false;
  let authError = '';

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  $: visibleAssets = assets.slice(0, visibleCount);
  $: groups = groupAssets(visibleAssets);
  $: canShowMore = visibleCount < assets.length || (!!nextCursor && !query.trim());

  onMount(() => {
    init();
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('scroll', handleScroll);
    };
  });

  async function init() {
    checkingSession = true;
    error = '';
    try {
      const status = await fetchJSON<SetupStatus>('/api/setup');
      setupRequired = status.setup_required;
      user = status.user ?? null;
      authMode = setupRequired ? 'setup' : 'login';
      if (user) await loadInitial();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to reach server';
    } finally {
      checkingSession = false;
    }
  }

  async function submitAuth() {
    authBusy = true;
    authError = '';
    try {
      const endpoint = authMode === 'setup' ? '/api/setup' : '/api/login';
      const status = await fetchJSON<SetupStatus>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      setupRequired = status.setup_required;
      user = status.user ?? null;
      password = '';
      if (user) await loadInitial();
    } catch (err) {
      authError = err instanceof Error ? err.message : 'Authentication failed';
    } finally {
      authBusy = false;
    }
  }

  async function logout() {
    await fetchJSON('/api/logout', { method: 'POST' });
    user = null;
    authMode = 'login';
    assets = [];
    selected = null;
  }

  async function loadInitial() {
    loading = true;
    error = '';
    visibleCount = windowSize;
    try {
      const data = await fetchAssets();
      assets = data.assets;
      nextCursor = data.next_cursor ?? '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to load library';
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (loadingMore) return;
    if (visibleCount < assets.length) {
      visibleCount += windowSize;
      return;
    }
    if (!nextCursor || query.trim()) return;
    loadingMore = true;
    error = '';
    try {
      const data = await fetchAssets(nextCursor);
      assets = [...assets, ...data.assets];
      nextCursor = data.next_cursor ?? '';
      visibleCount += windowSize;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to load more';
    } finally {
      loadingMore = false;
    }
  }

  async function runSearch() {
    loading = true;
    error = '';
    visibleCount = windowSize;
    try {
      const endpoint = query.trim()
        ? `/api/search?q=${encodeURIComponent(query.trim())}&limit=200`
        : '/api/assets?limit=100';
      const data = await fetchJSON<AssetList>(endpoint);
      assets = data.assets;
      nextCursor = data.next_cursor ?? '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Search failed';
    } finally {
      loading = false;
    }
  }

  async function fetchAssets(cursor = '') {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    return fetchJSON<AssetList>(`/api/assets?${params.toString()}`);
  }

  async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (res.status === 401) {
      user = null;
      authMode = 'login';
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = typeof body.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
      throw new Error(message);
    }
    return res.json() as Promise<T>;
  }

  function groupAssets(input: Asset[]) {
    const map = new Map<string, Asset[]>();
    for (const asset of input) {
      const key = asset.taken_day ?? asset.created_at.slice(0, 10);
      const current = map.get(key);
      if (current) current.push(asset);
      else map.set(key, [asset]);
    }
    return [...map.entries()].map(([day, items]) => ({ day, items }));
  }

  function labelDate(day: string) {
    const parsed = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return day;
    return dateFormatter.format(parsed);
  }

  function fileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function openAsset(asset: Asset) {
    selected = asset;
    selectedImageLoaded = false;
  }

  function closeViewer() {
    selected = null;
  }

  function moveSelection(delta: number) {
    if (!selected || assets.length === 0) return;
    const idx = assets.findIndex((asset) => asset.id === selected?.id);
    if (idx === -1) return;
    const next = assets[idx + delta];
    if (next) openAsset(next);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!selected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelection(-1);
    }
  }

  function handleScroll() {
    if (!user || loadingMore || !canShowMore) return;
    const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    if (remaining < 900) loadMore();
  }
</script>

<svelte:head>
  <title>Kuraki</title>
  <meta name="theme-color" content="#f6f3ee" />
</svelte:head>

<main class="shell">
  <header class="topbar">
    <div>
      <h1>Kuraki</h1>
      <p>{user ? `${assets.length} items` : 'personal photo backup'}</p>
    </div>
    {#if user}
      <form class="search" on:submit|preventDefault={runSearch}>
        <Search size={18} aria-hidden="true" />
        <input bind:value={query} type="search" placeholder="Search filename, camera, date" />
        <button type="submit" aria-label="Search">
          <Search size={18} />
        </button>
      </form>
      <button class="icon logout" type="button" on:click={logout} aria-label="Log out">
        <LogOut size={18} />
      </button>
    {/if}
  </header>

  {#if checkingSession}
    <section class="grid skeleton" aria-label="Loading">
      {#each Array(18) as _}
        <div></div>
      {/each}
    </section>
  {:else if !user}
    <section class="auth-panel">
      <form class="auth-form" on:submit|preventDefault={submitAuth}>
        <Lock size={22} aria-hidden="true" />
        <h2>{authMode === 'setup' ? 'Create admin access' : 'Sign in'}</h2>
        <input bind:value={username} autocomplete="username" placeholder="Username" />
        <input
          bind:value={password}
          autocomplete={authMode === 'setup' ? 'new-password' : 'current-password'}
          placeholder="Password"
          type="password"
        />
        {#if authError}
          <p class="auth-error">{authError}</p>
        {/if}
        <button type="submit" disabled={authBusy}>{authBusy ? 'Working' : authMode === 'setup' ? 'Set up' : 'Sign in'}</button>
      </form>
    </section>
  {:else}
    {#if error}
      <section class="notice" role="status">{error}</section>
    {/if}

    {#if loading}
      <section class="grid skeleton" aria-label="Loading assets">
        {#each Array(18) as _}
          <div></div>
        {/each}
      </section>
    {:else if assets.length === 0}
      <section class="empty">
        <h2>No assets yet</h2>
      </section>
    {:else}
      <section class="timeline">
        {#each groups as group}
          <section class="day">
            <h2>{labelDate(group.day)}</h2>
            <div class="grid">
              {#each group.items as asset}
                <button class="tile" type="button" on:click={() => openAsset(asset)} aria-label={asset.filename}>
                  {#if asset.thumbnail_url}
                    <img src={asset.thumbnail_url} alt={asset.filename} loading="lazy" />
                  {:else}
                    <span>{asset.media_type}</span>
                  {/if}
                  {#if asset.favorite}
                    <span class="favorite"><Star size={15} fill="currentColor" /></span>
                  {/if}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </section>
      {#if canShowMore}
        <button class="more" type="button" disabled={loadingMore} on:click={loadMore}>
          {loadingMore ? 'Loading' : 'Load more'}
        </button>
      {/if}
    {/if}
  {/if}
</main>

{#if selected}
  <div class="viewer" role="dialog" aria-modal="true">
    <button class="icon close" type="button" on:click={closeViewer} aria-label="Close">
      <X size={22} />
    </button>
    <div class="stage">
      {#if selected.media_type === 'image'}
        {#if selected.thumbnail_url && !selectedImageLoaded}
          <img class="preview" src={selected.thumbnail_url} alt="" aria-hidden="true" />
        {/if}
        <img
          class:loaded={selectedImageLoaded}
          src={selected.original_url}
          alt={selected.filename}
          on:load={() => (selectedImageLoaded = true)}
        />
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={selected.original_url} poster={selected.thumbnail_url} controls></video>
      {/if}
    </div>
    <aside class="info">
      <div>
        <h2>{selected.filename}</h2>
        <p>{fileSize(selected.size_bytes)} · {selected.width}x{selected.height}</p>
      </div>
      <dl>
        {#if selected.taken_at}
          <div><dt>Taken</dt><dd>{new Date(selected.taken_at).toLocaleString()}</dd></div>
        {/if}
        {#if selected.camera_model}
          <div><dt>Camera</dt><dd>{selected.camera_make} {selected.camera_model}</dd></div>
        {/if}
        {#if selected.gps_lat && selected.gps_lon}
          <div><dt>GPS</dt><dd>{selected.gps_lat.toFixed(5)}, {selected.gps_lon.toFixed(5)}</dd></div>
        {/if}
      </dl>
      <a class="download" href={selected.original_url} download>
        <Download size={18} />
        Download
      </a>
    </aside>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #f6f3ee;
    color: #171717;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button,
  input {
    font: inherit;
  }

  .shell {
    width: min(1440px, 100%);
    margin: 0 auto;
    padding: 18px;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: grid;
    grid-template-columns: minmax(160px, auto) minmax(240px, 520px) 40px;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 72px;
    padding: 12px 0;
    background: color-mix(in srgb, #f6f3ee 92%, transparent);
    backdrop-filter: blur(18px);
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 24px;
    line-height: 1.1;
    font-weight: 700;
  }

  .topbar p {
    margin-top: 4px;
    color: #6a6259;
    font-size: 14px;
  }

  .search {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) 40px;
    align-items: center;
    width: 100%;
    height: 44px;
    gap: 8px;
    padding: 0 4px 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
  }

  .search input,
  .auth-form input {
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
  }

  .auth-form input {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
  }

  .search button,
  .icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: white;
    cursor: pointer;
  }

  .logout {
    justify-self: end;
  }

  .notice,
  .empty,
  .auth-panel {
    display: grid;
    place-items: center;
    min-height: 220px;
    color: #6a6259;
  }

  .auth-panel {
    min-height: 520px;
  }

  .auth-form {
    display: grid;
    width: min(360px, 100%);
    gap: 12px;
    color: #24211f;
  }

  .auth-form h2 {
    font-size: 22px;
  }

  .auth-form button {
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    background: #24211f;
    color: white;
    cursor: pointer;
    font-weight: 700;
  }

  .auth-form button:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .auth-error {
    color: #a33a2a;
    font-size: 14px;
  }

  .timeline {
    display: grid;
    gap: 28px;
  }

  .day {
    display: grid;
    gap: 10px;
  }

  .day h2 {
    font-size: 15px;
    font-weight: 700;
    color: #4f4942;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 8px;
  }

  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    border-radius: 6px;
    background: #ded6ca;
    color: #5f574e;
    cursor: pointer;
    padding: 0;
  }

  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .tile span:not(.favorite) {
    display: grid;
    place-items: center;
    height: 100%;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 700;
  }

  .favorite {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #fff7;
    color: #2b2621;
  }

  .skeleton div {
    aspect-ratio: 1;
    border-radius: 6px;
    background: linear-gradient(90deg, #e6ded3, #f9f5ee, #e6ded3);
    background-size: 220% 100%;
    animation: pulse 1.4s infinite;
  }

  .more {
    display: block;
    min-width: 140px;
    height: 42px;
    margin: 26px auto 0;
    border: 1px solid #cfc5b8;
    border-radius: 8px;
    background: #fffaf3;
    color: #24211f;
    cursor: pointer;
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    background: #111;
    color: #f7f3ec;
  }

  .close {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 22;
    background: #ffffff20;
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    padding: 18px;
    overflow: hidden;
  }

  .stage img,
  .stage video {
    max-width: 100%;
    max-height: calc(100vh - 36px);
    object-fit: contain;
  }

  .stage img:not(.preview) {
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .stage img.loaded {
    opacity: 1;
  }

  .stage .preview {
    position: absolute;
    width: min(100%, 1000px);
    height: min(100%, 1000px);
    filter: blur(18px);
    opacity: 0.42;
    transform: scale(1.04);
    object-fit: contain;
  }

  .info {
    display: grid;
    align-content: start;
    gap: 20px;
    padding: 68px 22px 22px;
    border-left: 1px solid #ffffff1f;
    background: #1b1815;
  }

  .info h2 {
    overflow-wrap: anywhere;
    font-size: 18px;
  }

  .info p,
  dd {
    color: #c9c0b6;
  }

  dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }

  dt {
    color: #8f8579;
    font-size: 12px;
    text-transform: uppercase;
  }

  dd {
    margin: 3px 0 0;
    overflow-wrap: anywhere;
  }

  .download {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 42px;
    border-radius: 8px;
    background: #f6f3ee;
    color: #171717;
    text-decoration: none;
    font-weight: 700;
  }

  @keyframes pulse {
    to {
      background-position: -220% 0;
    }
  }

  @media (max-width: 780px) {
    .shell {
      padding: 12px;
    }

    .topbar {
      position: static;
      grid-template-columns: 1fr auto;
    }

    .search {
      grid-column: 1 / -1;
      width: 100%;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
      gap: 6px;
    }

    .viewer {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .info {
      max-height: 42vh;
      overflow: auto;
      padding: 18px;
      border-top: 1px solid #ffffff1f;
      border-left: 0;
    }
  }
</style>
