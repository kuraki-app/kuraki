<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Pencil, Trash2, ArrowLeft } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';

  // Guaranteed by the [id] route segment; SvelteKit types params as optional.
  $: id = $page.params.id!;
  let name = 'Album';

  $: if (id) loadName();
  async function loadName() {
    try {
      const { albums } = await api.albums();
      name = albums.find((a) => a.id === id)?.name ?? 'Album';
    } catch {
      name = 'Album';
    }
  }
  async function rename() {
    const next = prompt('Album name', name);
    if (!next || !next.trim()) return;
    try {
      await api.renameAlbum(id, next.trim());
      name = next.trim();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rename failed');
    }
  }
  async function remove() {
    if (!confirm('Delete this album? Your photos are not deleted.')) return;
    try {
      await api.deleteAlbum(id);
      goto('/albums');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed');
    }
  }
</script>

{#key id}
  <LibraryView
    load={() => api.album(id)}
    albumId={id}
    title={name}
    emptyText="This album is empty — add photos from the timeline"
  >
    <div slot="actions" class="flex gap-1.5">
      <Button variant="outline" size="icon" href="/albums" aria-label="Back to albums">
        <ArrowLeft size={16} aria-hidden="true" />
      </Button>
      <Button variant="outline" onclick={rename}><Pencil size={15} aria-hidden="true" /> Rename</Button>
      <Button variant="outline" class="text-destructive hover:text-destructive" onclick={remove}>
        <Trash2 size={15} aria-hidden="true" /> Delete
      </Button>
    </div>
  </LibraryView>
{/key}
