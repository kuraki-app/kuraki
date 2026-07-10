<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, Trash2 } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/stores';
  import { fileSize } from '$lib/format';
  import type { DupAsset } from '$lib/types';

  let groups: DupAsset[][] = [];
  let loading = true;
  let selected = new Set<string>();

  onMount(load);
  async function load() {
    loading = true;
    selected = new Set();
    try {
      groups = (await api.duplicates()).groups;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load duplicates');
    } finally {
      loading = false;
    }
  }
  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }
  async function remove() {
    if (selected.size === 0) return;
    if (!confirm(`Move ${selected.size} selected ${selected.size === 1 ? 'copy' : 'copies'} to trash?`)) return;
    try {
      await api.batch('delete', [...selected]);
      showToast(`Moved ${selected.size} to trash`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  $: total = groups.reduce((n, g) => n + g.length, 0);
</script>

<header class="head">
  <div>
    <h1>Duplicates</h1>
    <p>Visually identical copies — nothing is removed until you choose. The largest is listed first.</p>
  </div>
</header>

{#if loading}
  <p class="muted">Loading…</p>
{:else if groups.length === 0}
  <div class="empty"><h2>No duplicates found</h2></div>
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
  <div class="bar" role="toolbar">
    <span>{selected.size} selected</span>
    <button type="button" class="del" on:click={remove}><Trash2 size={16} /> Move to trash</button>
    <button type="button" class="clear" on:click={() => (selected = new Set())}>Clear</button>
  </div>
{/if}

<style>
  .head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }
  .head p {
    margin: 3px 0 16px;
    color: #6a6259;
    font-size: 14px;
    max-width: 640px;
  }
  .muted {
    color: #6a6259;
  }
  .empty {
    display: grid;
    place-items: center;
    min-height: 260px;
    color: #6a6259;
  }
  .summary {
    margin: 0 0 14px;
    color: #6a6259;
    font-size: 13px;
  }
  .group {
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid #e5ddd1;
    border-radius: 12px;
    background: #fffaf3;
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
    background: #ded6ca;
    cursor: pointer;
    overflow: hidden;
    text-align: left;
  }
  .tile.sel {
    border-color: #a33a2a;
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
    color: #4f4942;
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
    background: #24211f;
    color: #f7f3ec;
    box-shadow: 0 12px 34px #0004;
  }
  .bar .del {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: #ffffff14;
    color: #ff9a86;
    cursor: pointer;
    font-size: 13px;
  }
  .bar .clear {
    border: 0;
    background: none;
    color: #c9c0b6;
    cursor: pointer;
    font-size: 13px;
  }
</style>
