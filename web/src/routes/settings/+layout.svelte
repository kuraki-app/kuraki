<script lang="ts">
  import { page } from '$app/stores';
  import { User, Users, Palette, SlidersHorizontal, Smartphone, Activity, Server } from '@lucide/svelte';

  const items = [
    { href: '/settings', label: 'Overview', icon: SlidersHorizontal, exact: true },
    { href: '/settings/account', label: 'Account', icon: User },
    { href: '/settings/appearance', label: 'Appearance', icon: Palette },
    { href: '/settings/library', label: 'Library', icon: SlidersHorizontal },
    { href: '/settings/devices', label: 'Devices', icon: Smartphone },
    { href: '/settings/activity', label: 'Activity', icon: Activity },
    { href: '/settings/server', label: 'Server', icon: Server },
    // Admin-only server-side; the page itself renders a plain "admins only"
    // message on 403 rather than the nav guessing at the caller's role.
    { href: '/settings/users', label: 'Users', icon: Users }
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
    gap: calc(var(--space-step) * 6);
    align-items: start;
    /* The rail and the panel stay a single block. Without this the shell
     * stretched to whatever the (now uncapped) content column offers, and the
     * 180px rail ended up marooned a long way from the settings it labels. */
    max-width: 1040px;
  }
  /* Settings are read, not browsed. Measured at 1440 the panel ran the full
   * ~1200px with rows whose content stops after a third of it, so a setting's
   * label sat a long way from its control and the page filled 31-77% of the
   * fold as a wide, sparse field.
   *
   * A reading measure pulls label and control back together and gives the
   * column an edge, which is what makes the remaining space read as margin
   * rather than as something missing. The photo surfaces are deliberately NOT
   * capped — a timeline should use every pixel it is given. */
  .panel {
    max-width: 68ch;
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
    gap: calc(var(--space-step) * 2);
    /* Was 7px/10px — two values on no scale at all. The Vault rhythm is 4px, so
     * these are 2 and 3 steps. */
    padding: calc(var(--space-step) * 2) calc(var(--space-step) * 3);
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
  @media (max-width: 820px) {
    .settings-shell {
      /* `1fr` has an automatic minimum of min-content, so the single column was
       * floored by the widest thing in it — the rail's row of nowrap links —
       * and the whole document could be dragged sideways at 320px. The same
       * `minmax(0, 1fr)` idiom AssetGrid documents for the same reason. */
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: static;
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 4px;
      padding-bottom: 4px;
      -webkit-overflow-scrolling: touch;
      /* The rail becomes a scroller here, and the last item was cut mid-word
       * with no cue — on a phone, Server and Users looked like they did not
       * exist. The mask fades the trailing edge so the cut reads as "more this
       * way" rather than as a rendering accident, and it costs no element and
       * no scroll listener. */
      mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
      /* The document must not be draggable sideways at the narrowest supported
       * width: `min-width: 0` lets this grid child actually shrink instead of
       * being floored by its content, which is what pushed 320px 3px wide. */
      min-width: 0;
    }
    .rail::-webkit-scrollbar {
      display: none;
    }
    .rail a {
      flex: none;
      white-space: nowrap;
    }
  }
</style>
