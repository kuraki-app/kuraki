<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { page } from '$app/stores';
  import { Menu, Upload, LogOut, Monitor, Sun, Moon } from '@lucide/svelte';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { MOBILE_TABS, NAV_GROUPS, isActive } from '$lib/nav';
  import SegmentedControl from './SegmentedControl.svelte';

  // The sidebar is hidden below 820px, so the sheet is the only place Upload,
  // theme and sign-out remain reachable on mobile. The layout owns the file
  // input and the session, so those two actions go back up as events.
  const dispatch = createEventDispatcher<{ upload: void; signout: void }>();

  let sheetOpen = false;
  let sheetEl: HTMLDivElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;

  const modes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor }
  ] as const;

  // Close on navigation: the sheet is fixed, so it would otherwise survive a
  // route change and cover the page the user just asked for.
  $: if ($page.url.pathname) sheetOpen = false;

  // Dialog focus contract: move focus into the sheet on open, and back to the
  // trigger on close, no matter which path closed it (Escape, re-toggle, a
  // link inside the sheet, or the route-change guard above). Without this a
  // keyboard user who dismisses the sheet gets dumped at the top of the
  // document. `previousOpen` lets one reactive block cover every transition
  // instead of duplicating the same two lines at every call site that flips
  // `sheetOpen`.
  let previousOpen = false;
  $: {
    if (sheetOpen && !previousOpen) {
      tick().then(() => sheetEl?.focus());
    } else if (!sheetOpen && previousOpen) {
      triggerEl?.focus();
    }
    previousOpen = sheetOpen;
  }

  // Outside-click-to-close. The trigger button is excluded so this never
  // fights the tab bar's own toggle click, and other tab-bar links already
  // close the sheet via the route-change guard above.
  function onDocumentClick(e: MouseEvent) {
    if (!sheetOpen) return;
    const target = e.target as Node;
    if (sheetEl?.contains(target) || triggerEl?.contains(target)) return;
    sheetOpen = false;
  }
</script>

<svelte:window
  on:keydown={(e) => e.key === 'Escape' && (sheetOpen = false)}
  on:click={onDocumentClick}
/>

<nav class="tabs" aria-label="Primary">
  {#each MOBILE_TABS as item (item.href)}
    <a
      href={item.href}
      class:active={isActive(item.href, $page.url.pathname)}
      aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
    >
      <svelte:component this={item.icon} size={20} aria-hidden="true" />
      <span>{item.label}</span>
    </a>
  {/each}
  <button
    type="button"
    bind:this={triggerEl}
    class:active={sheetOpen}
    aria-expanded={sheetOpen}
    on:click={() => (sheetOpen = !sheetOpen)}
  >
    <Menu size={20} aria-hidden="true" />
    <span>More</span>
  </button>
</nav>

{#if sheetOpen}
  <div class="sheet" role="dialog" aria-label="More sections" tabindex="-1" bind:this={sheetEl}>
    {#each NAV_GROUPS as group (group.label)}
      <h2>{group.label}</h2>
      <div class="sheet-items">
        {#each group.items as item (item.href)}
          <a href={item.href} on:click={() => (sheetOpen = false)}>
            <svelte:component this={item.icon} size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        {/each}
      </div>
    {/each}

    <h2>This device</h2>
    <div class="sheet-items">
      <button
        type="button"
        class="sheet-action"
        on:click={() => {
          sheetOpen = false;
          dispatch('upload');
        }}
      >
        <Upload size={18} aria-hidden="true" />
        <span>Upload</span>
      </button>
      <SegmentedControl
        label="Theme"
        options={modes}
        fill
        value={userPrefersMode.current}
        onchange={(v) => setMode(v)}
      />
      <button
        type="button"
        class="sheet-action"
        on:click={() => {
          sheetOpen = false;
          dispatch('signout');
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border-top: 1px solid var(--border);
    background: var(--sidebar);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tabs a,
  .tabs button {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 8px 4px;
    border: 0;
    background: none;
    color: var(--text-dim);
    text-decoration: none;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs .active {
    color: var(--stamp);
  }
  .sheet {
    position: fixed;
    inset: auto 0 calc(58px + env(safe-area-inset-bottom, 0)) 0;
    z-index: 19;
    max-height: 60vh;
    overflow-y: auto;
    padding: 14px 16px 18px;
    border-top: 1px solid var(--border);
    background: var(--popover);
    box-shadow: var(--shadow);
  }
  .sheet h2 {
    margin: 12px 0 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .sheet-items {
    display: grid;
    gap: 2px;
  }
  .sheet a,
  .sheet .sheet-action {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--foreground);
    text-decoration: none;
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }

  /* Mirror of the layout's 820px breakpoint, inverted: above it the sidebar is
   * the nav, so the tab bar must not also be on screen. Last in the sheet so
   * it out-orders the equal-specificity `display` rules above. */
  @media (min-width: 821px) {
    .tabs,
    .sheet {
      display: none;
    }
  }
</style>
