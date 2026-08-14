<script lang="ts">
  import { Archive } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={(cursor) => api.archived(cursor)}
  title="Archive"
  subtitle="Archived items stay private and out of your timeline"
  archiveMode
  emptyText="Nothing archived"
  emptyBody="Archiving keeps a photo in your library but out of the timeline. Select photos and choose Archive — you can bring them back from here."
>
  <svelte:fragment slot="empty-icon"><Archive size={20} aria-hidden="true" /></svelte:fragment>
  <svelte:fragment slot="empty-action">
    <Button variant="outline" href="/">Browse the timeline</Button>
  </svelte:fragment>
</LibraryView>
