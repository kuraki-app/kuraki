<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import 'leaflet.markercluster/dist/MarkerCluster.css';
  import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
  import Viewer from '$lib/components/Viewer.svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import type { Asset, PlaceGroup } from '$lib/types';

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

<header class="head">
  <div>
    <h1>Places</h1>
    <p>{assets.length} located {assets.length === 1 ? 'photo' : 'photos'}</p>
  </div>
</header>

<div class="map" bind:this={mapEl}></div>

{#if !loading && places.length > 0}
  <div class="places">
    {#each places as p (p.country + p.city)}
      <button type="button" class="place" on:click={() => focusPlace(p)}>
        <img src={p.cover_thumb_url} alt="" loading="lazy" />
        <div>
          <strong>{p.city}</strong>
          <span>{p.country} · {p.count}</span>
        </div>
      </button>
    {/each}
  </div>
{:else if !loading}
  <p class="none">No photos with location yet. Import photos that carry GPS to see them here.</p>
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
  .head {
    margin-bottom: 16px;
  }
  .head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }
  .head p {
    margin: 3px 0 0;
    color: #6a6259;
    font-size: 14px;
  }
  .map {
    height: 60vh;
    min-height: 360px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e5ddd1;
  }
  .places {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    margin-top: 16px;
  }
  .place {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid #e5ddd1;
    border-radius: 10px;
    background: #fffaf3;
    cursor: pointer;
    text-align: left;
  }
  .place img {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    object-fit: cover;
  }
  .place strong {
    display: block;
    color: #24211f;
    overflow-wrap: anywhere;
  }
  .place span {
    color: #8a8175;
    font-size: 13px;
  }
  .none {
    margin-top: 18px;
    color: #6a6259;
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
