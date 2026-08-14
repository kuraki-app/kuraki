<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import 'leaflet.markercluster/dist/MarkerCluster.css';
  import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
  import Viewer from '$lib/components/Viewer.svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { Asset, PlaceGroup } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { MapPin } from '@lucide/svelte';

  let mapEl: HTMLDivElement;
  let map: any;
  let L: any;
  let assets: Asset[] = [];
  let places: PlaceGroup[] = [];
  let loading = true;
  let viewerIndex = -1;

  onMount(async () => {
    L = (await import('leaflet')).default;
    await import('leaflet.markercluster');

    try {
      const [pa, ps] = await Promise.all([api.places(), api.placesSummary()]);
      assets = pa.assets.filter((a) => a.gps_lat != null && a.gps_lon != null);
      places = ps.places;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load places');
    } finally {
      loading = false;
    }

    // A world map with nothing on it does not read as "no photos carry GPS" —
    // it reads as broken. With no located assets there is no map at all, and
    // the empty state takes the space instead.
    if (assets.length === 0) return;

    // The container only exists once `loading` is false and the count is known,
    // so wait for that render before handing the node to Leaflet.
    await tick();

    map = L.map(mapEl).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const cluster = (L as any).markerClusterGroup({ maxClusterRadius: 48 });
    assets.forEach((a, i) => {
      const icon = L.divIcon({
        className: 'photo-pin',
        html: `<img src="${a.thumbnail_url ?? a.original_url}" alt="" />`,
        iconSize: [46, 46]
      });
      const marker = L.marker([a.gps_lat as number, a.gps_lon as number], { icon });
      marker.on('click', () => (viewerIndex = i));
      cluster.addLayer(marker);
    });
    map.addLayer(cluster);
    if (assets.length) {
      try {
        map.fitBounds(cluster.getBounds().pad(0.2));
      } catch {
        /* single point */
      }
    }
  });

  onDestroy(() => {
    if (map) map.remove();
  });

  function focusPlace(p: PlaceGroup) {
    const a = assets.find((x) => x.place_city === p.city && (x.place_country ?? '') === p.country);
    if (a && a.gps_lat != null && a.gps_lon != null && map) map.setView([a.gps_lat, a.gps_lon], 11);
  }

  async function favorite(asset: Asset) {
    const next = !asset.favorite;
    try {
      await api.setFavorite(asset.id, next);
      assets = assets.map((x) => (x.id === asset.id ? { ...x, favorite: next } : x));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed');
    }
  }
</script>

<PageHeader title="Places" subtitle={`${assets.length} located ${assets.length === 1 ? 'photo' : 'photos'}`} />

{#if loading}
  <div class="map map-loading" aria-hidden="true"></div>
{:else if assets.length > 0}
  <div class="map" bind:this={mapEl}></div>
{:else}
  <EmptyState
    title="No photos with a location yet"
    body="Photos carry GPS from the camera or phone that took them. Import photos that have it, or add a location to a single photo from its details."
  >
    <svelte:fragment slot="icon"><MapPin size={20} aria-hidden="true" /></svelte:fragment>
  </EmptyState>
{/if}

{#if !loading && places.length > 0}
  <div class="places">
    {#each places as p (p.country + p.city)}
      <!-- Two actions, because tapping a place means two different things: the
           tile pans the map to it, and "View photos" opens the filtered grid.
           Only the map half existed, so a place could be located but its photos
           could never be listed — the mobile client has always done both. -->
      <div class="place-row">
        <button type="button" class="place" on:click={() => focusPlace(p)}>
          <img src={p.cover_thumb_url} alt="" loading="lazy" />
          <div>
            <strong>{p.city}</strong>
            <span>{p.country} · {p.count}</span>
          </div>
        </button>
        <a
          class="view"
          href={`/?place_city=${encodeURIComponent(p.city)}&place_country=${encodeURIComponent(p.country)}`}
        >
          View photos
        </a>
      </div>
    {/each}
  </div>
{/if}

{#if viewerIndex >= 0}
  <Viewer
    {assets}
    index={viewerIndex}
    on:navigate={(e) => (viewerIndex = e.detail)}
    on:close={() => (viewerIndex = -1)}
    on:favorite={(e) => favorite(e.detail)}
  />
{/if}

<style>
  .map {
    height: 60vh;
    min-height: 360px;
    border-radius: var(--frame-radius, 12px);
    overflow: hidden;
    border: 1px solid var(--border);
    /* The map's own ground while tiles load, so the panel does not flash white
     * on a paper-coloured page. */
    background: var(--muted);
  }
  .map-loading {
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.72;
    }
  }

  /* ---- Leaflet, dressed in the app's clothes -----------------------------
   *
   * Leaflet ships its own chrome: square white buttons with a black border, a
   * blue-link attribution, and a bright basemap. Against warm paper and soft
   * rounded controls it read as an embedded third-party widget — the one
   * screen in the app that looked like it came from somewhere else.
   *
   * These are `:global` because Leaflet builds its DOM outside Svelte, so the
   * scoped class never reaches it. */

  /* Tone the basemap toward the palette. A filter on the tile pane leaves the
   * tiles themselves untouched — no new hosts, no re-hosting, and the whole
   * treatment is one declaration to remove. OSM's blue water and white land
   * are the loudest things on the page otherwise. */
  :global(.leaflet-tile-pane) {
    filter: saturate(0.42) sepia(0.16) brightness(1.02) contrast(0.92);
  }
  /* Dark mode inverts and re-rotates the hue, the standard trick for a light
   * basemap, then mutes what the inversion oversaturates. */
  :global(.dark) :global(.leaflet-tile-pane) {
    filter: invert(0.92) hue-rotate(180deg) saturate(0.32) brightness(0.94) contrast(0.9);
  }

  :global(.leaflet-container) {
    background: var(--muted);
    font-family: var(--font-sans);
  }

  :global(.leaflet-control-zoom) {
    border: 0 !important;
    box-shadow: var(--shadow);
    border-radius: var(--frame-radius, 8px);
    overflow: hidden;
  }
  /* Specificity is the whole game here. Leaflet sizes these with
   * `.leaflet-touch .leaflet-bar a` (0,2,0) and `.leaflet-bar a` (0,1,1), and a
   * plain `.leaflet-control-zoom a` (0,1,1) loses the tie on source order —
   * which is why the first attempt at this changed nothing visible. Matching
   * both of Leaflet's own selectors wins without reaching for !important. */
  :global(.leaflet-bar a.leaflet-control-zoom-in),
  :global(.leaflet-bar a.leaflet-control-zoom-out),
  :global(.leaflet-touch .leaflet-bar a.leaflet-control-zoom-in),
  :global(.leaflet-touch .leaflet-bar a.leaflet-control-zoom-out) {
    /* 30x30 was below any target floor; these are the map's only controls. */
    width: 40px;
    height: 40px;
    line-height: 40px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    color: var(--foreground);
    font-size: 18px;
    font-weight: 500;
  }
  :global(.leaflet-control-zoom a:last-child) {
    border-bottom: 0;
  }
  :global(.leaflet-control-zoom a:hover) {
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.leaflet-control-attribution) {
    padding: 2px 8px;
    border-radius: var(--frame-radius, 6px) 0 0 0;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--text-faint);
    font-size: 11px;
  }
  :global(.leaflet-control-attribution a) {
    color: var(--text-dim);
  }
  .places {
    display: grid;
    /* 220px was sized for a card holding a thumbnail and two lines of text.
     * Adding "View photos" to the row left the name about 50px wide, and with
     * `overflow-wrap: anywhere` a city then broke mid-word — "Kyot / o". */
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
    margin-top: 16px;
  }
  /* The card is the frame; the tile and the link sit inside it, so the two
   * actions read as one place rather than two unrelated controls. */
  .place-row {
    display: flex;
    align-items: center;
    /* Wraps rather than squeezing the name: on a narrow card "View photos"
     * drops to its own line instead of taking the width out of the label. */
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
  }
  .place {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .view {
    flex: none;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--muted);
    color: var(--foreground);
    font-size: 13px;
    text-decoration: none;
    white-space: nowrap;
  }
  .view:hover {
    background: var(--accent);
  }
  .place img {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    object-fit: cover;
  }
  .place strong {
    display: block;
    color: var(--foreground);
    /* `anywhere` breaks between any two characters as soon as the box is
     * tight; `break-word` only breaks a word that genuinely cannot fit on a
     * line of its own, which is what a long place name actually needs. */
    overflow-wrap: break-word;
  }
  .place span {
    color: var(--text-faint);
    font-size: 13px;
  }
  :global(.photo-pin img) {
    width: 46px;
    height: 46px;
    border-radius: 8px;
    border: 2px solid #fff;
    object-fit: cover;
    box-shadow: 0 2px 8px #0004;
  }
</style>
