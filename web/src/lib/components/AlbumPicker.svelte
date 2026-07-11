<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { Album } from '$lib/types';

  export let albums: Album[] = [];
  const dispatch = createEventDispatcher();
  let name = '';
  let open = true;

  // bits-ui owns focus-trap, Escape, and backdrop dismissal; closing (any path)
  // flips `open`, which we relay to the parent so it can unmount.
  function handleOpenChange(next: boolean) {
    if (!next) dispatch('close');
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>Add to album</Dialog.Title>
    </Dialog.Header>

    <div class="grid max-h-[46vh] gap-1.5 overflow-auto">
      {#each albums as album (album.id)}
        <button
          type="button"
          class="flex items-center justify-between rounded-md border bg-card px-3 py-2.5 text-left text-[15px] transition-colors hover:bg-accent"
          on:click={() => dispatch('pick', album.id)}
        >
          <span class="truncate">{album.name}</span>
          <span class="text-[13px] text-muted-foreground">{album.asset_count ?? 0}</span>
        </button>
      {/each}
      {#if albums.length === 0}
        <p class="m-0 text-muted-foreground">No albums yet — create one below.</p>
      {/if}
    </div>

    <form
      class="grid grid-cols-[1fr_auto] gap-2"
      on:submit|preventDefault={() => name.trim() && dispatch('create', name.trim())}
    >
      <Input bind:value={name} placeholder="New album name" aria-label="New album name" />
      <Button type="submit" disabled={!name.trim()}>Create</Button>
    </form>
  </Dialog.Content>
</Dialog.Root>
