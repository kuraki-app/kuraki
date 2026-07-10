<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Pencil, Trash2, ArrowLeft } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';

  $: id = $page.params.id;
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
    <div slot="actions" class="actions">
      <a href="/albums" class="ghost" aria-label="Back to albums"><ArrowLeft size={16} /></a>
      <button type="button" class="ghost" on:click={rename}><Pencil size={15} /> Rename</button>
      <button type="button" class="ghost danger" on:click={remove}><Trash2 size={15} /> Delete</button>
    </div>
  </LibraryView>
{/key}

<style>
  .actions {
    display: flex;
    gap: 6px;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    background: #fffaf3;
    color: #4f4942;
    text-decoration: none;
    cursor: pointer;
    font-size: 14px;
  }
  .ghost.danger {
    color: #a33a2a;
  }
</style>
