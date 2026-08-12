<script lang="ts">
  import { onMount } from 'svelte';
  import { Flame } from '@lucide/svelte';
  import LibraryView from '$lib/components/LibraryView.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { api } from '$lib/api';
  import { bumpLibrary, showToast } from '$lib/stores';

  // The subtitle used to hardcode "permanently removed after 30 days" while
  // `trash_retention_days` is a live, owner-editable setting — so the page
  // actively lied the moment anyone changed it. 30 is still the default, and is
  // what we say until the server tells us otherwise.
  let retentionDays = 30;
  let count = 0;
  let confirmOpen = false;
  let busy = false;

  onMount(async () => {
    try {
      const { settings } = await api.settings();
      const row = settings.find((s) => s.key === 'trash_retention_days');
      const days = Number(row?.value ?? row?.default);
      if (Number.isFinite(days) && days > 0) retentionDays = days;
    } catch {
      /* non-fatal: the default is the honest fallback, and the list still works */
    }
  });

  async function emptyTrash() {
    busy = true;
    try {
      // Page through the trash rather than assuming one request holds it all:
      // the list endpoint is cursor-paginated at 100, and a trash with more than
      // that would otherwise be only partly emptied while reporting success.
      const ids: string[] = [];
      let cursor = '';
      do {
        const page = await api.trash(cursor);
        ids.push(...page.assets.map((a) => a.id));
        cursor = page.next_cursor ?? '';
      } while (cursor);

      if (ids.length === 0) {
        showToast('Trash is already empty');
        confirmOpen = false;
        return;
      }
      // maxBatchIDs is 1000 on the server, so chunk rather than 400 on a big trash.
      for (let i = 0; i < ids.length; i += 500) {
        await api.batch('purge', ids.slice(i, i + 500));
      }
      showToast(`Permanently deleted ${ids.length}`);
      confirmOpen = false;
      bumpLibrary();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not empty the trash');
    } finally {
      busy = false;
    }
  }
</script>

<LibraryView
  load={async (cursor) => {
    const page = await api.trash(cursor);
    if (!cursor) count = page.assets.length;
    return page;
  }}
  title="Trash"
  subtitle="Items are permanently removed after {retentionDays} {retentionDays === 1 ? 'day' : 'days'}"
  trashMode
  emptyText="Trash is empty"
>
  <svelte:fragment slot="actions">
    {#if count > 0}
      <Button variant="outline" onclick={() => (confirmOpen = true)}>
        <Flame size={16} aria-hidden="true" /> Empty trash
      </Button>
    {/if}
  </svelte:fragment>
</LibraryView>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Empty the trash?"
  body="Every item in the trash is permanently deleted and its original file is removed from disk. This cannot be undone."
  confirmLabel="Empty trash"
  destructive
  {busy}
  onconfirm={emptyTrash}
/>
