import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import LibraryStatsCard from '@/components/library-stats';
import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import { Spacing, useTokens } from '@/constants/theme';
import { clearMutations } from '@/lib/cache/mutations';
import { connectionView } from '@/lib/connection-view';
import { isAuthLost } from '@/lib/session';
import { clearDeviceToken, clearSetupComplete, loadCaptureSettings } from '@/lib/settings';

// The settings index is a directory, not a dumping ground: every control lives
// on a subpage, and this screen answers "how big is my library" and "where do I
// go". The connection row carries its state as a detail, so a disconnected
// device is visible without opening anything.
export default function SettingsIndex() {
  const tokens = useTokens();
  const [host, setHost] = useState('');
  const [hasToken, setHasToken] = useState(false);

  const reload = useCallback(async () => {
    const s = await loadCaptureSettings();
    setHost(s.baseURL.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
    setHasToken(Boolean(s.deviceToken));
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app.
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const view = connectionView({ hasToken, connection: isAuthLost() ? 'disconnected' : 'online' });
  const connectionDetail =
    view === 'unpaired' ? 'Not paired' : view === 'disconnected' ? 'Disconnected' : host;

  async function disconnect() {
    await clearDeviceToken();
    await clearSetupComplete();
    await clearMutations();
    router.replace('/(setup)/welcome');
  }

  return (
    // The ScrollView is the screen's direct child on purpose. Wrapped in a
    // ThemedView, react-native-screens never applied the large-title content
    // inset -- `contentInsetAdjustmentBehavior="automatic"` was already set and
    // still did nothing -- so "Settings" drew straight over the stats card. The
    // background moves onto the scroll view itself to keep the same paint.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}>
      <LibraryStatsCard />

      <SettingsSection>
        <SettingsRow label="Backup" icon="arrow.up.circle" href="/(app)/settings/backup" />
        <SettingsRow
          label="Connection"
          icon="wifi"
          detail={connectionDetail}
          href="/(app)/settings/connection"
        />
        <SettingsRow label="Activity" icon="waveform.path.ecg" href="/(app)/settings/activity" />
        <SettingsRow label="Notifications" icon="bell" href="/(app)/settings/notifications" />
        <SettingsRow label="Photo Grid" icon="square.grid.3x3" href="/(app)/settings/grid" />
      </SettingsSection>

      <SettingsSection title="Library">
        <SettingsRow label="Trash" icon="trash" href="/(app)/settings/trash" />
        <SettingsRow label="Duplicates" icon="square.on.square" href="/(app)/settings/duplicates" />
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        footer="Disconnecting removes this device’s pairing and sends it back through setup. Backed-up photos on the server are unaffected.">
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
