<script lang="ts">
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView load={() => api.hidden()} title="Hidden" subtitle="Hidden items stay out of everyday browsing" emptyText="No hidden items" />
