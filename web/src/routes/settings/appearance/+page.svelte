<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { Sun, Moon, Monitor } from '@lucide/svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import { gridDensity, defaultView, grouping, type GridDensity } from '$lib/prefs';
  import { GROUPINGS } from '$lib/format';
  const themes = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
    { value: 'system' as const, label: 'System', icon: Monitor }
  ];

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
  <SettingRow id="theme" kind="static" label="Theme" description="Also available from the sidebar.">
    <SegmentedControl
      label="Theme"
      options={themes}
      value={userPrefersMode.current}
      onchange={(v) => setMode(v)}
    />
  </SettingRow>

  <SettingRow id="density" kind="static" label="Grid density" description="Also available above the timeline.">
    <SegmentedControl
      label="Grid density"
      options={densities}
      value={$gridDensity}
      onchange={(v) => gridDensity.set(v)}
    />
  </SettingRow>

  <SettingRow
    id="grouping"
    kind="static"
    label="Group timeline by"
    description="How the timeline splits into headed sections."
  >
    <SegmentedControl
      label="Group timeline by"
      options={GROUPINGS}
      value={$grouping}
      onchange={(v) => grouping.set(v)}
    />
  </SettingRow>

  <SettingRow id="default-view" kind="static" label="Default view" description="Where the app opens after you sign in.">
    <SegmentedControl
      label="Default view"
      options={views}
      value={$defaultView}
      onchange={(v) => defaultView.set(v)}
    />
  </SettingRow>
</section>

<style>
  .group {
    max-width: 560px;
  }
</style>
