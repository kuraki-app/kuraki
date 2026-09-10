import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import { Spacing, useTokens } from '@/constants/theme';
import { clearMutations } from '@/lib/cache/mutations';
import { clearDeviceToken, clearSetupComplete } from '@/lib/settings';

export default function AdvancedSettings() {
  const tokens = useTokens();

  async function disconnect() {
    await clearDeviceToken();
    await clearSetupComplete();
    await clearMutations();
    router.replace('/(setup)/welcome');
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}>
      <SettingsSection title="Preferences">
        <SettingsRow label="Notifications" icon="bell" href="/(app)/settings/notifications" />
        <SettingsRow label="Photo Grid" icon="square.grid.3x3" href="/(app)/settings/grid" />
      </SettingsSection>

      <SettingsSection title="Device">
        <SettingsRow label="Permissions" icon="lock.shield" href="/(app)/settings/permissions" />
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        info={{
          title: 'Disconnect this device',
          message: 'This removes the pairing from this phone. Photos already backed up to the server are not affected.',
        }}>
        <SettingsRow label="Disconnect this device" destructive onPress={() => void disconnect()} />
      </SettingsSection>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.four },
  spacer: { height: Spacing.four },
});
