<script lang="ts">
  import { page } from '$app/stores';
  import { ArrowLeft, Pencil } from '@lucide/svelte';
  import type { Trip } from '$lib/types';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import PromptDialog from '$lib/components/PromptDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { tripSubtitle, tripTitle } from '../../../../../shared/trips';

  // Guaranteed by the [id] route segment; SvelteKit types params as optional.
  $: id = $page.params.id!;

  // The trip's facts come from the list endpoint, the same way the tag page
  // confirms a tag name. Until they arrive the heading says "Trip" rather than
  // flashing an id.
  let trip: Trip | null = null;
  $: if (id) void loadTrip(id);
  async function loadTrip(current: string) {
    try {
      const { trips } = await api.trips();
      trip = trips.find((t) => t.id === current) ?? null;
    } catch {
      trip = null;
    }
  }

  $: heading = trip ? tripTitle(trip) : 'Trip';
  $: subheading = trip ? tripSubtitle(trip) : '';

  // Renaming is wired here rather than left to the API alone: tags, ratings and
  // shift-time each shipped with a server route and an api.ts method that no
  // surface ever called, and each went unnoticed until someone went looking.
  let renameOpen = false;
  let renameValue = '';
  let renaming = false;

  function askRename() {
    renameValue = trip?.name ?? '';
    renameOpen = true;
  }

  async function rename(value: string) {
    renaming = true;
    try {
      await api.patchTrip(id, { name: value });
      renameOpen = false;
      await loadTrip(id);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not rename that trip.');
    } finally {
      renaming = false;
    }
  }
</script>

{#key id}
  <LibraryView
    load={(cursor, signal) => api.trip(id, cursor, signal)}
    title={heading}
    subtitle={subheading || 'Photos from this trip.'}
    emptyText="Nothing in this trip"
    emptyBody="Photos leave a trip when you remove them, and rejoin it if you add them back."
  >
    <div slot="actions" class="flex gap-1.5">
      <Button variant="outline" size="icon" onclick={askRename} aria-label="Rename trip">
        <Pencil size={16} aria-hidden="true" />
      </Button>
      <Button variant="outline" size="icon" href="/trips" aria-label="Back to trips">
        <ArrowLeft size={16} aria-hidden="true" />
      </Button>
    </div>
  </LibraryView>
{/key}

<PromptDialog
  bind:open={renameOpen}
  title="Rename this trip"
  label="Trip name"
  placeholder={trip ? tripTitle({ ...trip, name: '' }) : 'Trip'}
  bind:value={renameValue}
  confirmLabel="Save name"
  busy={renaming}
  onsubmit={rename}
/>
