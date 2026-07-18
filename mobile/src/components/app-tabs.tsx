import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTokens } from '@/constants/theme';

export default function AppTabs() {
  const tokens = useTokens();

  return (
    <NativeTabs
      backgroundColor={tokens.background}
      indicatorColor={tokens.card}
      labelStyle={{ selected: { color: tokens.foreground } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Backup</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="arrow.up.circle" md="upload" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="photo.on.rectangle" md="photo_library" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
