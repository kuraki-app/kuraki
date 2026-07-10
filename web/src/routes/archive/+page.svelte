<script lang="ts">
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView load={() => api.archived()} title="Archive" subtitle="Archived items stay private and out of your timeline" emptyText="Your archive is empty" />
