<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Pencil, Trash2, ArrowLeft, ImagePlus } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import PromptDialog from '$lib/components/PromptDialog.svelte';
  import AlbumPhotoPicker from '$lib/components/AlbumPhotoPicker.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
  import { bumpLibrary, showToast } from '$lib/stores';

  // Guaranteed by the [id] route segment; SvelteKit types params as optional.
  $: id = $page.params.id!;
  let name = 'Album';

  // Adding photos from inside the album. The ids already in it are read from
  // the album itself so the picker can show them as accounted for rather than
  // offering them again.
  let picking = false;
  let existing = new Set<string>();

  async function openPicker() {
    try {
      // Every page, not just the first: this drives the "already in this album"
      // marks, and a partial read would offer photos the album already holds.
      // Bounded so a server that kept handing back a cursor cannot spin here.
      const ids = new Set<string>();
      let cursor = '';
      for (let page = 0; page < 50; page++) {
        const res = await api.album(id, cursor);
        for (const a of res.assets) ids.add(a.id);
        if (!res.next_cursor) break;
        cursor = res.next_cursor;
      }
      existing = ids;
    } catch {
      // A failed read only costs the marks; the add itself is idempotent
      // server-side, so the picker is still safe to open without them.
      existing = new Set();
    }
    picking = true;
  }

  async function addPhotos(ids: string[]) {
    try {
      const { added } = await api.addToAlbum(id, ids);
      picking = false;
      // The album view is a LibraryView driven by this store.
      bumpLibrary();
      showToast(
        added === 0
          ? 'Already in this album'
          : `Added ${added} ${added === 1 ? 'photo' : 'photos'}`
      );
    } catch (cause) {
      picking = false;
      showToast(cause instanceof Error ? cause.message : 'Could not add to this album');
    }
  }

  $: if (id) loadName();
  async function loadName() {
    try {
      const { albums } = await api.albums();
      name = albums.find((a) => a.id === id)?.name ?? 'Album';
    } catch {
      name = 'Album';
    }
  }
  let renameOpen = false;
  let renameValue = '';
  let renaming = false;
  function askRename() {
    renameValue = name;
    renameOpen = true;
  }
  async function rename(next: string) {
    renaming = true;
    try {
      await api.renameAlbum(id, next);
      name = next;
      renameOpen = false;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      renaming = false;
    }
  }

  let removeOpen = false;
  let removing = false;
  async function remove() {
    removing = true;
    try {
      await api.deleteAlbum(id);
      goto('/albums');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      removing = false;
    }
  }
</script>

{#key id}
  <LibraryView
    load={(cursor) => api.album(id, cursor)}
    albumId={id}
    title={name}
    emptyText="This album is empty — use Add photos, or add from the timeline"
  >
    <div slot="actions" class="flex gap-1.5">
      <Button variant="outline" size="icon" href="/albums" aria-label="Back to albums">
        <ArrowLeft size={16} aria-hidden="true" />
      </Button>
      <Button variant="outline" onclick={openPicker}>
        <ImagePlus size={15} aria-hidden="true" /> Add photos
      </Button>
      <Button variant="outline" onclick={askRename}><Pencil size={15} aria-hidden="true" /> Rename</Button>
      <Button variant="outline" class="text-destructive hover:text-destructive" onclick={() => (removeOpen = true)}>
        <Trash2 size={15} aria-hidden="true" /> Delete
      </Button>
    </div>
  </LibraryView>
{/key}

{#if picking}
  <AlbumPhotoPicker
    {existing}
    on:close={() => (picking = false)}
    on:add={(e) => addPhotos(e.detail)}
  />
{/if}

<PromptDialog
  bind:open={renameOpen}
  bind:value={renameValue}
  title="Rename album"
  label="Album name"
  confirmLabel="Rename"
  busy={renaming}
  onsubmit={rename}
/>

<ConfirmDialog
  bind:open={removeOpen}
  title="Delete this album?"
  body="The album is removed. Your photos stay in the library — an album is only a grouping."
  confirmLabel="Delete album"
  destructive
  busy={removing}
  onconfirm={remove}
/>
