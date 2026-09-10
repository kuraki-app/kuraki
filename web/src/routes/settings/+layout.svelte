<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { session } from '$lib/stores';
  import { User, Users, Palette, SlidersHorizontal, Smartphone, Activity, Server, LayoutDashboard } from '@lucide/svelte';

  const items = [
    { href: '/settings', label: 'Overview', icon: LayoutDashboard, group: 'Your library' },
    { href: '/settings/account', label: 'Account', icon: User, group: 'Your library' },
    { href: '/settings/appearance', label: 'Appearance', icon: Palette, group: 'Your library' },
    { href: '/settings/devices', label: 'Devices', icon: Smartphone, group: 'Your library' },
    { href: '/settings/activity', label: 'Activity', icon: Activity, group: 'Your library' },
    { href: '/settings/library', label: 'Library', icon: SlidersHorizontal, group: 'Administration', admin: true },
    { href: '/settings/server', label: 'Server', icon: Server, group: 'Administration', admin: true },
    { href: '/settings/users', label: 'Users', icon: Users, group: 'Administration', admin: true }
  ];
  $: visible = items.filter(item => !item.admin || $session.user?.role === 'admin');
  $: current = items.find(item => item.href === $page.url.pathname);
  $: restricted = current?.admin && $session.user?.role !== 'admin';
</script>

<div class="settings-shell">
  <nav class="rail" aria-label="Settings sections">
    <p class="settings-label">Settings</p>
    {#each ['Your library', 'Administration'] as group}
      {#if visible.some(item => item.group === group)}
        <div class="nav-group">
          <p class="group-label">{group}</p>
          {#each visible.filter(item => item.group === group) as item (item.href)}
            <a href={item.href} class:active={current === item} aria-current={current === item ? 'page' : undefined}>
              <svelte:component this={item.icon} size={17} aria-hidden="true" />
              {item.label}
            </a>
          {/each}
        </div>
      {/if}
    {/each}
  </nav>
  <div class="mobile-sections">
    <label for="settings-section">Settings</label>
    <select id="settings-section" value={$page.url.pathname} on:change={(event) => goto(event.currentTarget.value)}>
      {#each visible as item (item.href)}<option value={item.href}>{item.label}</option>{/each}
    </select>
  </div>
  <div class="panel">
    {#if restricted}
      <h1>{current?.label}</h1>
      <p class="access-note">Only an admin can manage {current?.label.toLowerCase()} settings.</p>
      <a href="/settings">Back to overview</a>
    {:else}<slot />{/if}
  </div>
</div>

<style>
  .settings-shell { display: grid; grid-template-columns: 184px minmax(0, 1fr); gap: 32px; align-items: start; max-width: 1100px; margin: 12px auto; }
  .panel { min-width: 0; container: settings / inline-size; }
  .rail { display: grid; gap: 24px; position: sticky; top: 24px; }
  .settings-label { padding: 0 12px; font-size: 20px; font-weight: 650; letter-spacing: -.03em; }
  .nav-group { display: grid; gap: 4px; }
  .group-label { padding: 0 12px 4px; font-size: 12px; color: var(--muted-foreground); }
  .rail a { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 8px 12px; border-radius: var(--media-radius); color: var(--text-dim); text-decoration: none; font-size: 14px; font-weight: 500; }
  .rail a:hover, .rail a.active { background: var(--accent); color: var(--foreground); }
  .mobile-sections { display: none; }
  .access-note { margin: 16px 0; color: var(--muted-foreground); }
  h1 { font-size: 24px; font-weight: 600; }
  /* The content measure, not the viewport, decides when setting controls wrap. */
  .panel :global(section.group) { max-width: none; border: 1px solid var(--border); border-radius: var(--collection-radius); background: var(--card); padding: 8px 20px; margin-bottom: 20px; }
  .panel :global(section.group > h2) { margin-top: 12px; }
  .panel :global(.page-header) { margin-bottom: 24px; }
  .panel :global(.page-title) { font-size: 28px; letter-spacing: -.035em; }
  .panel :global(.num) { flex-wrap: wrap; max-width: 100%; }
  @media (max-width: 1040px) { .settings-shell { gap: 20px; grid-template-columns: 160px minmax(0, 1fr); } }
  @media (max-width: 820px) {
    .settings-shell { grid-template-columns: minmax(0, 1fr); gap: 24px; margin: 8px; }
    .rail { display: none; }
    .mobile-sections { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .mobile-sections label { font-weight: 600; font-size: 16px; }
    select { min-height: 44px; max-width: 65%; padding: 8px 12px; border: 1px solid var(--input); border-radius: var(--media-radius); color: var(--foreground); background: var(--card); font: inherit; font-size: 14px; }
    .panel :global(section.group) { padding: 4px 16px; }
  }
</style>
