<script lang="ts">
  import { page } from '$app/stores';
  import { User, Palette, SlidersHorizontal, Smartphone, Activity, Server } from '@lucide/svelte';

  const items = [
    { href: '/settings', label: 'Overview', icon: SlidersHorizontal, exact: true },
    { href: '/settings/account', label: 'Account', icon: User },
    { href: '/settings/appearance', label: 'Appearance', icon: Palette },
    { href: '/settings/library', label: 'Library', icon: SlidersHorizontal },
    { href: '/settings/devices', label: 'Devices', icon: Smartphone },
    { href: '/settings/activity', label: 'Activity', icon: Activity },
    { href: '/settings/server', label: 'Server', icon: Server }
  ];

  function active(href: string, exact: boolean | undefined, pathname: string) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
  }
</script>

<div class="settings-shell">
  <nav class="rail" aria-label="Settings sections">
    {#each items as item (item.href)}
      <a
        href={item.href}
        class:active={active(item.href, item.exact, $page.url.pathname)}
        aria-current={active(item.href, item.exact, $page.url.pathname) ? 'page' : undefined}
      >
        <svelte:component this={item.icon} size={16} aria-hidden="true" />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="panel">
    <slot />
  </div>
</div>

<style>
  .settings-shell {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: calc(var(--space-step) * 4);
    align-items: start;
  }
  .rail {
    display: grid;
    gap: 2px;
    position: sticky;
    top: calc(var(--space-step) * 3);
  }
  .rail a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--frame-radius);
    color: var(--text-dim);
    text-decoration: none;
    font-size: 13px;
    font-weight: 500;
  }
  .rail a.active {
    background: var(--accent);
    color: var(--foreground);
  }
  @media (max-width: 780px) {
    .settings-shell {
      grid-template-columns: 1fr;
    }
    .rail {
      position: static;
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 4px;
      padding-bottom: 4px;
      -webkit-overflow-scrolling: touch;
    }
    .rail a {
      flex: none;
      white-space: nowrap;
    }
  }
</style>
