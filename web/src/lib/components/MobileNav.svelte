<script lang="ts">
  import { page } from '$app/stores';
  import { glassSurface } from './GlassSurface';
  import { MOBILE_TABS, isMobileActive } from '$lib/nav';
</script>

<nav class="tabs" aria-label="Primary" use:glassSurface={'navigation'}>
  {#each MOBILE_TABS as item (item.href)}
    <a
      href={item.href}
      class:active={isMobileActive(item, $page.url.pathname, $page.url.searchParams.get('search') ?? '')}
      aria-current={isMobileActive(item, $page.url.pathname, $page.url.searchParams.get('search') ?? '') ? 'page' : undefined}
    >
      <svelte:component this={item.icon} size={20} aria-hidden="true" />
      <span>{item.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tabs a {
    display: grid;
    min-height: 52px;
    justify-items: center;
    align-content: center;
    gap: 3px;
    padding: 6px 4px;
    color: var(--text-dim);
    text-decoration: none;
    font-size: 11px;
    font-weight: 600;
    transition:
      color var(--t-crisp) var(--e-vault),
      transform var(--t-instant) var(--e-vault);
  }
  .tabs a:active {
    transform: scale(var(--press-scale));
  }
  .tabs a :global(svg) {
    transition: transform var(--t-crisp) var(--e-kura);
  }
  .tabs a.active {
    color: var(--stamp);
  }
  .tabs a.active :global(svg) {
    transform: translateY(-2px) scale(1.08);
  }

  @media (min-width: 821px) {
    .tabs {
      display: none;
    }
  }
</style>
