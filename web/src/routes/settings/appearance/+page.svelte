<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { Sun, Moon, Monitor } from '@lucide/svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import { gridDensity, defaultView, grouping, type GridDensity } from '$lib/prefs';
  import { GROUPINGS } from '$lib/format';
  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor }
  ] as const;

  const densities: { value: GridDensity; label: string }[] = [
    { value: 'compact', label: 'Compact' },
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'large', label: 'Large' }
  ];

  const views = [
    { value: '/', label: 'Timeline' },
    { value: '/favorites', label: 'Favorites' },
    { value: '/albums', label: 'Albums' },
    { value: '/places', label: 'Places' }
  ];
</script>

<PageHeader title="Appearance" subtitle="Theme, density, and where the app opens." />

<section class="group">
  <SettingRow id="theme" kind="group" label="Theme" description="Also available from the sidebar.">
    <div class="seg">
      {#each themes as t (t.value)}
        <button type="button" class:on={userPrefersMode.current === t.value} onclick={() => setMode(t.value)}>
          <t.icon size={14} aria-hidden="true" /> {t.label}
        </button>
      {/each}
    </div>
  </SettingRow>

  <SettingRow id="density" kind="group" label="Grid density" description="Also available above the timeline.">
    <div class="seg">
      {#each densities as d (d.value)}
        <button type="button" class:on={$gridDensity === d.value} onclick={() => gridDensity.set(d.value)}>
          {d.label}
        </button>
      {/each}
    </div>
  </SettingRow>

  <SettingRow
    id="grouping"
    kind="group"
    label="Group timeline by"
    description="How the timeline splits into headed sections."
  >
    <div class="seg">
      {#each GROUPINGS as g (g.value)}
        <button type="button" class:on={$grouping === g.value} onclick={() => grouping.set(g.value)}>
          {g.label}
        </button>
      {/each}
    </div>
  </SettingRow>

  <SettingRow id="default-view" kind="group" label="Default view" description="Where the app opens after you sign in.">
    <div class="seg">
      {#each views as v (v.value)}
        <button type="button" class:on={$defaultView === v.value} onclick={() => defaultView.set(v.value)}>
          {v.label}
        </button>
      {/each}
    </div>
  </SettingRow>
</section>

<style>
  .group {
    max-width: 560px;
  }
  .seg {
    display: flex;
    gap: 4px;
  }
  .seg button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--frame-radius);
    background: var(--card);
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent);
    color: var(--foreground);
    border-color: var(--stamp);
  }
</style>
