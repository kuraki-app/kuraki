<script lang="ts">
  import { onMount } from 'svelte';
  import { Luggage } from '@lucide/svelte';
  import type { Trip } from '$lib/types';
  import { api } from '$lib/api';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { coverLayout } from '../../../../shared/album-cover';
  import { tripSubtitle, tripTitle } from '../../../../shared/trips';

  // Trips are detected, not built by hand, so this page has no "New trip"
  // action -- the equivalent gesture is Rescan, which asks the server to look
  // again after an import.

  let trips: Trip[] = [];
  let loading = true;
  let error = '';
  let rescanning = false;

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api.trips();
      // Hidden trips stay hidden here; the server still sends them so a future
      // surface can offer them back.
      trips = res.trips.filter((t) => !t.hidden);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load trips.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function rescan() {
    if (rescanning) return;
    rescanning = true;
    try {
      await api.runTrips();
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not rescan.';
    } finally {
      rescanning = false;
    }
  }
</script>

<PageHeader title="Trips" subtitle="Stretches of time spent away from home.">
  <Button variant="outline" onclick={rescan} disabled={rescanning}>
    {rescanning ? 'Rescanning' : 'Rescan'}
  </Button>
</PageHeader>

{#if error}
  <div class="grid min-h-[120px] place-items-center gap-3 text-destructive" role="alert">
    <span>{error}</span>
    <Button variant="outline" onclick={load}>Try again</Button>
  </div>
{:else if loading}
  <p class="muted">Loading trips…</p>
{:else if trips.length === 0}
  <EmptyState
    title="No trips yet"
    body="A trip appears on its own once your library holds a run of photos taken away from home. Nothing to set up — import some photos with dates and locations, and they will group themselves."
  >
    <svelte:fragment slot="icon"><Luggage size={20} aria-hidden="true" /></svelte:fragment>
    <svelte:fragment slot="action">
      <Button variant="outline" onclick={rescan} disabled={rescanning}>
        {rescanning ? 'Rescanning' : 'Look again'}
      </Button>
    </svelte:fragment>
  </EmptyState>
{:else}
  <div class="grid">
    {#each trips as trip (trip.id)}
      {@const cover = coverLayout(trip.cover_asset_ids)}
      {@const subtitle = tripSubtitle(trip)}
      <a class="card" href={`/trips/${trip.id}`}>
        <div class="thumb" class:mosaic={cover.kind === 'mosaic'}>
          {#each cover.ids as id (id)}
            <img src={`/api/assets/${encodeURIComponent(id)}/thumb`} alt="" loading="lazy" decoding="async" />
          {:else}
            <Luggage size={26} aria-hidden="true" />
          {/each}
        </div>
        <div class="meta">
          <strong>{tripTitle(trip)}</strong>
          <!-- Dropped rather than rendered blank when the range is unreadable. -->
          <span>{subtitle ? `${subtitle} · ` : ''}{trip.asset_count} items</span>
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .muted {
    color: var(--muted-foreground);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr));
    gap: 24px 12px;
  }
  .card {
    display: grid;
    gap: 10px;
    padding: 0;
    min-width: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--foreground);
    text-decoration: none;
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--collection-radius);
    background: var(--accent);
    color: var(--text-faint);
  }
  .thumb.mosaic {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .meta strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .meta span {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .card:hover .meta strong {
    text-decoration: underline;
  }
</style>
