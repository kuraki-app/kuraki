<script lang="ts">
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={(cursor) => api.trash(cursor)}
  title="Trash"
  subtitle="Items are permanently removed after 30 days"
  trashMode
  emptyText="Trash is empty"
/>
