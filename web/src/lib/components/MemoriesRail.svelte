<script lang="ts">
  import type { Asset } from '$lib/types';
  import { memoryGroups } from '../../../../shared/memories';

  export let assets: Asset[] = [];
  $: groups = memoryGroups(assets);
</script>

{#if groups.length}
  <section class="memories" aria-label="Memories">
    <div class="heading"><h2>On this day</h2><a href="/memories">See all</a></div>
    <div class="rail">
      {#each groups as group (group.key)}
        <a class="memory" href="/memories" aria-label={`${group.title}, ${group.subtitle}`}>
          {#if group.cover.thumbnail_url}
            <img src={group.cover.thumbnail_url} alt="" loading="lazy" decoding="async" />
          {/if}
          <span class="caption"><strong>{group.title}</strong><span>{group.subtitle}</span></span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  .memories { min-width: 0; margin: 4px 0 24px; }
  .heading { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .heading a { color: var(--muted-foreground); font-size: 13px; padding: 8px 0 8px 12px; }
  .rail { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; padding: 2px 2px 8px; }
  .memory { position: relative; flex: 0 0 var(--memory-width); height: var(--memory-height); border-radius: var(--collection-radius); overflow: hidden; background: var(--thumb); scroll-snap-align: start; }
  .memory img { width: 100%; height: 100%; object-fit: cover; }
  .caption { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; padding: 12px; color: white; background: linear-gradient(transparent 25%, rgba(0,0,0,.85)); }
  .caption strong { font-size: 13px; line-height: 18px; }
  .caption span { font-size: 12px; }
</style>
