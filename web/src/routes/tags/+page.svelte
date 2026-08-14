<script lang="ts">
  import { onMount } from 'svelte';
  import { Tag as TagIcon, Trash2 } from '@lucide/svelte';
  import type { Tag } from '$lib/types';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';

  // Tags existed on the server and in api.ts, but no web surface ever called
  // them — the whole feature was reachable only from the mobile client.

  let tags: Tag[] = [];
  let loading = true;
  let error = '';
  let draft = '';
  let creating = false;

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api.tags();
      // Name order, so the list is stable between loads and matches mobile.
      tags = [...res.tags].sort((a, b) => a.name.localeCompare(b.name));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load tags.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function create() {
    const name = draft.trim();
    if (!name || creating) return;
    creating = true;
    try {
      await api.createTag(name);
      draft = '';
      await load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not create that tag.');
    } finally {
      creating = false;
    }
  }

  // Deleting a tag unfiles every photo carrying it, which is not obvious from a
  // row with a bin icon on it — so the dialog says so rather than a one-line
  // native confirm() that cannot be styled or read at leisure.
  let removeTarget: Tag | null = null;
  let removeOpen = false;
  let removing = false;
  function askRemove(tag: Tag) {
    removeTarget = tag;
    removeOpen = true;
  }
  async function remove() {
    if (!removeTarget) return;
    removing = true;
    try {
      await api.deleteTag(removeTarget.id);
      removeOpen = false;
      removeTarget = null;
      await load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not delete that tag.');
    } finally {
      removing = false;
    }
  }
</script>

<PageHeader title="Tags" subtitle="Your own labels, across the whole library." />

<form
  class="create"
  on:submit|preventDefault={create}
>
  <input
    bind:value={draft}
    placeholder="New tag"
    aria-label="New tag name"
    autocomplete="off"
    maxlength="80"
  />
  <Button type="submit" disabled={!draft.trim() || creating}>
    {creating ? 'Adding' : 'Add tag'}
  </Button>
</form>

{#if error}
  <div class="grid min-h-[120px] place-items-center gap-3 text-destructive" role="alert">
    <span>{error}</span>
    <Button variant="outline" onclick={load}>Try again</Button>
  </div>
{:else if loading}
  <p class="muted">Loading tags…</p>
{:else if tags.length === 0}
  <!-- No action here on purpose: the "New tag" form is directly above, and now
       that the empty state is anchored to its content rather than centred in
       the viewport, a second button would be pointing at a control already in
       view. -->
  <EmptyState
    title="Label photos with your own words"
    body="A tag works across the whole library. Add one above, then apply it from any photo's details."
  >
    <svelte:fragment slot="icon"><TagIcon size={20} aria-hidden="true" /></svelte:fragment>
  </EmptyState>
{:else}
  <ul class="list">
    {#each tags as tag (tag.id)}
      <li>
        <a href="/tags/{tag.id}?name={encodeURIComponent(tag.name)}">
          <TagIcon size={16} aria-hidden="true" />
          <span class="name">{tag.name}</span>
        </a>
        <button type="button" class="del" aria-label="Delete {tag.name}" on:click={() => askRemove(tag)}>
          <Trash2 size={15} />
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .create {
    display: flex;
    gap: 8px;
    max-width: 420px;
    margin-bottom: calc(var(--space-step) * 2);
  }
  .create input {
    flex: 1;
    min-height: 38px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--frame-radius);
    background: var(--card);
    color: var(--foreground);
    font-size: 14px;
  }
  .muted {
    color: var(--muted-foreground);
  }
  .list {
    display: grid;
    gap: 4px;
    max-width: 560px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: var(--frame-radius);
    background: var(--card);
  }
  .list a {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    color: var(--foreground);
    text-decoration: none;
    font-weight: 500;
  }
  .list a:hover .name {
    text-decoration: underline;
  }
  .del {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    margin-right: 6px;
    border: 0;
    border-radius: var(--frame-radius);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .del:hover {
    color: var(--destructive);
  }
</style>

<ConfirmDialog
  bind:open={removeOpen}
  title={`Delete the tag “${removeTarget?.name ?? ''}”?`}
  body="Photos keep their files and stay in your library; they just lose this tag."
  confirmLabel="Delete tag"
  destructive
  busy={removing}
  onconfirm={remove}
/>
