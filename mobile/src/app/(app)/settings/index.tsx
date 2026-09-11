import { useFocusEffect } from 'expo-router';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';

import LibraryStatsCard from '@/components/library-stats';
import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import { MaxContentWidth, Spacing, useTokens } from '@/constants/theme';
import { connectionView } from '@/lib/connection-view';
import { serverHost } from '@/lib/url';
import { classifyPermission, type PermissionStatus } from '@/lib/permissions';
import { isAuthLost } from '@/lib/session';
import { loadCaptureSettings } from '@/lib/settings';

// The settings index is a directory, not a dumping ground: every control lives
// on a subpage, and this screen answers "how big is my library" and "where do I
// go". The connection row carries its state as a detail, so a disconnected
// device is visible without opening anything.
export default function SettingsIndex() {
  const tokens = useTokens();
  const [host, setHost] = useState('');
  const [hasToken, setHasToken] = useState(false);
  // Photo access is carried as a row detail for the same reason the connection
  // state is: a device that cannot read the camera roll backs up nothing, and
  // that has to be visible without opening anything.
  const [photos, setPhotos] = useState<PermissionStatus>('granted');

  const reload = useCallback(async () => {
    const s = await loadCaptureSettings();
    // Same helper the stats card uses, so the two do not disagree about how an
    // address is spelled.
    setHost(serverHost(s.baseURL));
    setHasToken(Boolean(s.deviceToken));
    setPhotos(classifyPermission(await MediaLibrary.getPermissionsAsync()));
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app.
  //
  // On focus, not just on mount. Pairing happens on a screen pushed from this
  // one, so returning here never re-read and the row went on saying "Not
  // paired" directly above a stats card reporting a live connection -- the page
  // contradicting itself. The AppState listener stays for the other direction:
  // a permission changed in the iOS Settings app while Kuraki is backgrounded.
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => void reload(), 0);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void reload();
      });
      return () => {
        clearTimeout(timer);
        sub.remove();
      };
    }, [reload]),
  );

  const view = connectionView({ hasToken, connection: isAuthLost() ? 'disconnected' : 'online' });
  const connectionDetail =
    view === 'unpaired' ? 'Not paired' : view === 'disconnected' ? 'Disconnected' : host;
  const permissionsDetail =
    photos === 'granted' ? undefined : photos === 'limited' ? 'Limited' : 'Photo access off';

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
        {permissionsDetail ? (
          <SettingsRow
            label="Permissions"
            icon="lock.shield"
            detail={permissionsDetail}
            href="/(app)/settings/permissions"
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow label="Notifications" icon="bell" href="/(app)/settings/notifications" />
        <SettingsRow label="Photo Grid" icon="square.grid.3x3" href="/(app)/settings/grid" />
      </SettingsSection>

      <SettingsSection title="Library">
        <SettingsRow label="Free up space" icon="internaldrive" href="/(app)/settings/free-up-space" />
        <SettingsRow label="Trash" icon="trash" href="/(app)/settings/trash" />
        <SettingsRow label="Duplicates" icon="square.on.square" href="/(app)/settings/duplicates" />
      </SettingsSection>

      <SettingsSection title="More">
        <SettingsRow label="Advanced" icon="gearshape.2" href="/(app)/settings/advanced" />
      </SettingsSection>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.four },
  spacer: { height: Spacing.four },
});
