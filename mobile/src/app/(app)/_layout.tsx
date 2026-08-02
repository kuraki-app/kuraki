import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTokens } from '@/constants/theme';

// The real UITabBar, not a lookalike. iOS 26 already provides everything this
// screen needs: `minimizeBehavior="onScrollDown"` collapses the bar to a pill
// as the grid scrolls and restores it on the way back up, and a trigger with
// `role="search"` is rendered by the system as the separate circular search
// button to the right of that pill. A custom component reimplementing either
// would only be an approximation of a control the OS ships.
//
// Each tab points at a *group* that owns a Stack rather than at a bare screen,
// because NativeTabs draws no header. The parentheses keep every URL exactly
// where it was; what changes is that each tab can now push (Gallery -> a place
// or a tag, Albums -> an album, Settings -> its subpages) while keeping the tab
// bar, the system back button and the back gesture.
export default function AppLayout() {
  const tokens = useTokens();

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      backgroundColor={tokens.background}
      indicatorColor={tokens.card}
      labelStyle={{ selected: { color: tokens.foreground } }}>
      <NativeTabs.Trigger name="(gallery)">
        <NativeTabs.Trigger.Label>Gallery</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="photo.on.rectangle" md="photo_library" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(albums)">
        <NativeTabs.Trigger.Label>Albums</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="rectangle.stack" md="collections" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
