<script lang="ts">
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={() => api.memories()}
  title="On this day"
  subtitle="Photos from this day in past years"
  emptyText="Nothing from this day yet"
/>
