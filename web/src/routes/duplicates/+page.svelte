<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, RefreshCw, Trash2 } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize } from '$lib/format';
  import type { DupAsset, DuplicateRun } from '$lib/types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { Button } from '$lib/components/ui/button';

  let groups: DupAsset[][] = [];
  let run: DuplicateRun | null = null;
  let loading = true;
  let scanning = false;
  let selected = new Set<string>();
  let poll: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    load();
    return () => poll && clearInterval(poll);
  });

  async function load() {
    loading = true;
    selected = new Set();
    try {
      const res = await api.duplicates();
      groups = res.groups;
      run = res.run;
      watchRun();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load duplicates');
    } finally {
      loading = false;
    }
  }

  /** A scan is a background job, so the page follows it rather than showing a
   *  stale "no duplicates" until the user thinks to reload. */
  function watchRun() {
    const active = run?.status === 'queued' || run?.status === 'running';
    if (active && !poll) {
      poll = setInterval(async () => {
        try {
          const res = await api.duplicates();
          groups = res.groups;
          run = res.run;
          if (run?.status !== 'queued' && run?.status !== 'running') {
            if (poll) clearInterval(poll);
            poll = null;
          }
        } catch {
          /* transient: the next tick tries again */
        }
      }, 2000);
    } else if (!active && poll) {
      clearInterval(poll);
      poll = null;
    }
  }

  async function startScan() {
    scanning = true;
    try {
      await api.runDuplicatesScan();
      showToast('Duplicate scan started');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start the scan');
    } finally {
      scanning = false;
    }
  }
  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }
  let confirmOpen = false;
  let removing = false;
  async function remove() {
    removing = true;
    try {
      await api.batch('delete', [...selected]);
      showToast(`Moved ${selected.size} to trash`);
      confirmOpen = false;
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      removing = false;
    }
  }

  $: total = groups.reduce((n, g) => n + g.length, 0);
  $: scanRunning = run?.status === 'queued' || run?.status === 'running';
</script>

<PageHeader
  title="Duplicates"
  subtitle="Visually identical copies — nothing is removed until you choose. The largest is listed first."
>
  <Button variant="outline" disabled={scanning || scanRunning} onclick={startScan}>
    <RefreshCw size={16} aria-hidden="true" />
    {scanRunning ? 'Scanning' : 'Run scan'}
  </Button>
</PageHeader>

{#if loading}
  <p class="muted">Loading…</p>
{:else if scanRunning}
  <!-- An empty page during a scan used to be indistinguishable from an empty
       page after one. The run has always been in the response; the client
       typed it away. -->
  <p class="summary" role="status">
    Scanning the library… {run?.processed ?? 0} of {run?.total ?? 0} checked
    {#if (run?.group_count ?? 0) > 0}· {run?.group_count} groups so far{/if}
  </p>
{:else if run?.status === 'error'}
  <EmptyState title="The last duplicate scan failed">
    <p>{run.error || 'No further detail was recorded.'}</p>
  </EmptyState>
{:else if !run}
  <EmptyState title="No duplicate scan has run yet">
    <p>Scanning compares every photo in the library, so it is a deliberate step rather than something that happens on import.</p>
  </EmptyState>
{:else if groups.length === 0}
  <EmptyState title="No duplicates found" />
{:else}
  <p class="summary">{groups.length} {groups.length === 1 ? 'group' : 'groups'} · {total} copies</p>
  {#each groups as group, gi (gi)}
    <section class="group">
      <div class="row">
        {#each group as a (a.id)}
          <button class="tile" class:sel={selected.has(a.id)} type="button" on:click={() => toggle(a.id)}>
            {#if a.thumbnail_url}
              <img src={a.thumbnail_url} alt={a.filename} loading="lazy" />
            {/if}
            {#if selected.has(a.id)}<span class="check"><Check size={14} /></span>{/if}
            <span class="meta">{a.filename} · {fileSize(a.size_bytes)}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
{/if}

{#if selected.size > 0}
  <div class="bar" role="toolbar" aria-label="Duplicate actions">
    <span>{selected.size} selected</span>
    <button type="button" class="del" on:click={() => (confirmOpen = true)}>
      <Trash2 size={16} /> Move to trash
    </button>
    <button type="button" class="clear" on:click={() => (selected = new Set())}>Clear</button>
  </div>
{/if}

<ConfirmDialog
  bind:open={confirmOpen}
  title="Move {selected.size} {selected.size === 1 ? 'copy' : 'copies'} to trash?"
  body="They stay recoverable in the trash until the retention window elapses."
  confirmLabel="Move to trash"
  busy={removing}
  onconfirm={remove}
/>

<style>
  .muted {
    color: var(--muted-foreground);
  }
  .summary {
    margin: 0 0 14px;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .group {
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .tile {
    position: relative;
    width: 150px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 8px;
    background: var(--thumb);
    cursor: pointer;
    overflow: hidden;
    text-align: left;
  }
  .tile.sel {
    border-color: #d1483a;
  }
  .tile img {
    width: 150px;
    height: 120px;
    object-fit: cover;
    display: block;
  }
  .check {
    position: absolute;
    top: 8px;
    left: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #a33a2a;
    color: #fff;
  }
  .meta {
    display: block;
    padding: 6px 8px;
    color: var(--text-dim);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .bar {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border-radius: 12px;
    background: var(--chrome);
    color: var(--chrome-text);
    box-shadow: var(--shadow-strong);
  }
  .bar .del {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: var(--chrome-fill);
    color: var(--chrome-danger);
    cursor: pointer;
    font-size: 13px;
  }
  .bar .clear {
    border: 0;
    background: none;
    color: var(--chrome-muted);
    cursor: pointer;
    font-size: 13px;
  }
</style>
