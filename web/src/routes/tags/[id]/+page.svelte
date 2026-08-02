<script lang="ts">
  import { page } from '$app/stores';
  import { ArrowLeft } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';

  // Guaranteed by the [id] route segment; SvelteKit types params as optional.
  $: id = $page.params.id!;

  // The name arrives as a query param from the tags list so the heading is
  // right on first paint, and is confirmed against the server for anyone who
  // lands here from a bookmark or a shared link.
  $: name = $page.url.searchParams.get('name') ?? 'Tag';
  let resolved = '';
  $: heading = resolved || name;

  $: if (id) void confirmName(id);
  async function confirmName(current: string) {
    try {
      const { tags } = await api.tags();
      resolved = tags.find((t) => t.id === current)?.name ?? '';
    } catch {
      resolved = '';
    }
  }
</script>

{#key id}
  <LibraryView
    load={(cursor) => api.search({ tag: id }, cursor)}
    title={heading}
    subtitle="Everything tagged this way."
    emptyText="Nothing carries this tag yet"
  >
    <div slot="actions" class="flex gap-1.5">
      <Button variant="outline" size="icon" href="/tags" aria-label="Back to tags">
        <ArrowLeft size={16} aria-hidden="true" />
      </Button>
    </div>
  </LibraryView>
{/key}
