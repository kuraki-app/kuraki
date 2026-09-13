<script lang="ts">
  import { Archive, CalendarClock, FolderOpen, MapPin, Star, Tags } from '@lucide/svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const collections = [
    { href: '/favorites', label: 'Favorites', icon: Star },
    { href: '/albums', label: 'Albums', icon: FolderOpen },
    { href: '/memories', label: 'On this day', icon: CalendarClock },
    { href: '/places', label: 'Places', icon: MapPin },
    { href: '/tags', label: 'Tags', icon: Tags },
    { href: '/archive', label: 'Archive', icon: Archive }
  ];
</script>

<PageHeader title="Collections" subtitle="Browse your library another way." />

<nav class="collection-grid" aria-label="Collections">
  {#each collections as item (item.href)}
    <a class="motion-enter motion-lift" href={item.href}>
      <span class="icon"><svelte:component this={item.icon} size={22} aria-hidden="true" /></span>
      <strong>{item.label}</strong>
      <span class="arrow" aria-hidden="true">›</span>
    </a>
  {/each}
</nav>

<style>
  .collection-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--ds-spacing-two);
    max-width: var(--ds-layout-readable-max);
  }
  .collection-grid a {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--ds-spacing-two);
    min-height: 72px;
    padding: var(--ds-spacing-three);
    border: 1px solid var(--border);
    border-radius: var(--ds-radius-md);
    background: var(--card);
    color: var(--foreground);
    text-decoration: none;
    animation-delay: calc((var(--motion-order, 1) - 1) * 24ms);
  }
  .collection-grid a:nth-child(1) { --motion-order: 1; }
  .collection-grid a:nth-child(2) { --motion-order: 2; }
  .collection-grid a:nth-child(3) { --motion-order: 3; }
  .collection-grid a:nth-child(4) { --motion-order: 4; }
  .collection-grid a:nth-child(5) { --motion-order: 5; }
  .collection-grid a:nth-child(6) { --motion-order: 6; }
  .collection-grid a:hover {
    background: var(--accent);
  }
  .collection-grid a:active {
    transform: scale(var(--press-scale));
    box-shadow: none;
  }
  .collection-grid .icon {
    display: grid;
    color: var(--stamp);
  }
  .collection-grid .arrow {
    color: var(--text-faint);
    font-size: 20px;
    transition: transform var(--t-crisp) var(--e-kura);
  }
  .collection-grid a:hover .arrow,
  .collection-grid a:focus-visible .arrow {
    transform: translateX(3px);
  }
  @media (max-width: 599px) {
    .collection-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
