<script lang="ts">
  import { Star } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={(cursor) => api.favorites(cursor)}
  title="Favorites"
  emptyText="Keep your best photos together"
  emptyBody="Star a photo while viewing it, or select several and choose Favorite. Favorites stay in your timeline too."
>
  <svelte:fragment slot="empty-icon"><Star size={20} aria-hidden="true" /></svelte:fragment>
  <svelte:fragment slot="empty-action">
    <Button variant="outline" href="/">Browse the timeline</Button>
  </svelte:fragment>
</LibraryView>
