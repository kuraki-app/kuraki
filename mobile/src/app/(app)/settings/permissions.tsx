import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { backgroundAvailable } from '@/lib/background';
import { ensureNotificationPermission, notificationsAvailable } from '@/lib/notifications';
import {
  classifyPermission,
  permissionAction,
  type PermissionStatus,
} from '@/lib/permissions';

// The Permissions page answers "why is nothing backing up?".
//
// Every one of these was previously invisible or nearly so: photo access showed
// up as one line of grey text at the bottom of the Backup page, notification
// permission only as a section header on its own screen, and background refresh
// nowhere at all. All three can be switched off by the user or the OS long
// after setup, and when they are, backup stops without saying why.
export default function PermissionsSettings() {
  const tokens = useTokens();
  const [photos, setPhotos] = useState<PermissionStatus>('unavailable');
  const [notifications, setNotifications] = useState<PermissionStatus>('unavailable');
  const [background, setBackground] = useState<PermissionStatus>('unavailable');

  const refresh = useCallback(async () => {
    setPhotos(classifyPermission(await MediaLibrary.getPermissionsAsync()));

    if (notificationsAvailable()) {
      // getPermissionsAsync only reads; nothing here prompts on mount.
      const mod = await import('expo-notifications');
      setNotifications(classifyPermission(await mod.getPermissionsAsync()));
    } else {
      setNotifications('unavailable');
    }

    // Background refresh is a system-level toggle with no in-app grant path,
    // so it is reported as either working or needing the Settings app.
    setBackground((await backgroundAvailable()) ? 'granted' : 'denied');
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app. Re-read on
  // foreground, because the whole point of the "Open Settings" button is that
  // the user changes something in another app and comes back.
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [refresh]);

  async function grantPhotos() {
    await MediaLibrary.requestPermissionsAsync();
    await refresh();
  }

  async function grantNotifications() {
    await ensureNotificationPermission();
    await refresh();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}>
      <SettingsSection
        title="Photo access"
        footer="Kuraki reads your camera roll to back it up to your own server. Nothing is sent anywhere else.">
        <PermissionRow
          label="Photo library"
          status={photos}
          grantedNote="Kuraki can see your whole library."
          limitedNote="Only selected photos are shared, so everything else is skipped by backup. Change this to “All Photos” to back up your library."
          deniedNote="Access is off, so nothing can be backed up."
          undeterminedNote="Not granted yet."
          onGrant={() => void grantPhotos()}
        />
      </SettingsSection>

      <SettingsSection
        title="Background refresh"
        footer="Lets Kuraki back up and sync while it is closed. Without it, both happen only while the app is open.">
        <PermissionRow
          label="Background refresh"
          status={background}
          grantedNote="Kuraki can run in the background."
          deniedNote="Turned off for Kuraki, or restricted by Low Power Mode."
          undeterminedNote="Not available yet."
        />
      </SettingsSection>

      <SettingsSection
        title="Notifications"
        footer="Used only to tell you about this device’s own backup.">
        <PermissionRow
          label="Notifications"
          status={notifications}
          grantedNote="Kuraki can notify you."
          deniedNote="Notifications are blocked, so backup results stay silent."
          undeterminedNote="Not granted yet."
          unavailableNote="This build does not include notification support."
          onGrant={() => void grantNotifications()}
        />
      </SettingsSection>
    </ScrollView>
  );
}

function PermissionRow({
  label,
  status,
  grantedNote,
  limitedNote,
  deniedNote,
  undeterminedNote,
  unavailableNote,
  onGrant,
}: {
  label: string;
  status: PermissionStatus;
  grantedNote: string;
  limitedNote?: string;
  deniedNote: string;
  undeterminedNote: string;
  unavailableNote?: string;
  onGrant?: () => void;
}) {
  const tokens = useTokens();
  const action = permissionAction(status);

  const note =
    status === 'granted'
      ? grantedNote
      : status === 'limited'
        ? (limitedNote ?? grantedNote)
        : status === 'denied'
          ? deniedNote
          : status === 'undetermined'
            ? undeterminedNote
            : (unavailableNote ?? deniedNote);

  // Limited access is a warning, not a success: it reads as granted everywhere
  // else while hiding most of the library from backup.
  const tone =
    status === 'granted' ? tokens.foreground : status === 'limited' ? tokens.stamp : tokens.destructive;
  const badge =
    status === 'granted'
      ? 'On'
      : status === 'limited'
        ? 'Limited'
        : status === 'unavailable'
          ? 'Unavailable'
          : 'Off';

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <ThemedText type="smallBold" style={styles.rowLabel}>
          {label}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: tone }}>
          {badge}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="mutedForeground">
        {note}
      </ThemedText>
      {action === 'grant' && onGrant ? (
        <Pressable style={[styles.button, { backgroundColor: tokens.primary }]} onPress={onGrant}>
          <ThemedText type="smallBold" themeColor="primaryForeground">
            Allow
          </ThemedText>
        </Pressable>
      ) : action === 'system' ? (
        <Pressable
          style={[styles.buttonGhost, { borderColor: tokens.input }]}
          onPress={() => void Linking.openSettings()}>
          <ThemedText type="smallBold">Open Settings</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  row: { paddingVertical: Spacing.two, gap: Spacing.half },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowLabel: { flex: 1 },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.two, marginTop: Spacing.one },
  buttonGhost: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    padding: Spacing.two,
    marginTop: Spacing.one,
    borderWidth: 1,
  },
});
