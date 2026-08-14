<script lang="ts">
  import { CalendarClock } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={(cursor) => api.memories(cursor)}
  title="On this day"
  emptyText="Nothing from this day yet"
  emptyBody="On this day gathers photos taken on today's date in earlier years. It fills in as your library grows — or as you import older photos."
>
  <svelte:fragment slot="empty-icon"><CalendarClock size={20} aria-hidden="true" /></svelte:fragment>
</LibraryView>
