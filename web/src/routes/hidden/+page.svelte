<script lang="ts">
  import { EyeOff } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={(cursor) => api.hidden(cursor)}
  title="Hidden"
  subtitle="Hidden items stay out of everyday browsing"
  hiddenMode
  emptyText="Nothing hidden"
  emptyBody="Hiding keeps a photo out of everyday browsing without deleting it. Select photos and choose Hide — you can unhide them from here."
>
  <svelte:fragment slot="empty-icon"><EyeOff size={20} aria-hidden="true" /></svelte:fragment>
  <svelte:fragment slot="empty-action">
    <Button variant="outline" href="/">Browse the timeline</Button>
  </svelte:fragment>
</LibraryView>
