<script lang="ts">
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
</script>

<LibraryView
  load={() => api.favorites()}
  title="Favorites"
  favoritesMode
  emptyText="No favorites yet — tap the star on a photo"
/>
