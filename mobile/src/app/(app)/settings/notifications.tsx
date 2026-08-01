import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SettingsSection, SettingsSwitch } from '@/components/settings-ui';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ensureNotificationPermission, notificationsAvailable } from '@/lib/notifications';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '@/lib/prefs';

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    const timer = setTimeout(() => void loadPrefs().then(setPrefs), 0);
    return () => clearTimeout(timer);
  }, []);

  const [granted, setGranted] = useState(true);
  const available = notificationsAvailable();

  // Ask here, not from a background wake: Android has no Activity to attach the
  // dialog to when the OS wakes the app headlessly, so the request would fail
  // with nothing the user could see. Turning a switch *on* is the natural
  // moment to ask.
  const patch = useCallback(async (next: Partial<Prefs>) => {
    const turningOn = Object.values(next).some((v) => v === true);
    if (turningOn && available) setGranted(await ensureNotificationPermission());
    setPrefs(await savePrefs(next));
  }, [available]);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {!available ? (
          <SettingsSection
            title="Unavailable"
            footer="This build does not include notification support. Install a development or release build to receive them." >
            <View />
          </SettingsSection>
        ) : !granted ? (
          <SettingsSection
            title="Permission needed"
            footer="Notifications are switched on here but blocked by the system. Enable them for Kuraki in your device settings." >
            <View />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Backup"
          footer="Kuraki only notifies you about this device’s own backup. Nothing is sent anywhere.">
          <SettingsSwitch
            label="Backup finished"
            help="When a run finishes uploading everything waiting."
            value={prefs.notifyBackupComplete}
            onValueChange={(v) => void patch({ notifyBackupComplete: v })}
          />
          <SettingsSwitch
            label="Backup failed"
            help="When an item could not be uploaded after retrying."
            value={prefs.notifyBackupFailed}
            onValueChange={(v) => void patch({ notifyBackupFailed: v })}
          />
        </SettingsSection>

        <SettingsSection
          title="Connection"
          footer="A disconnected device stops backing up silently, so this one is worth leaving on.">
          <SettingsSwitch
            label="Device disconnected"
            help="When the server revokes this device’s access."
            value={prefs.notifyDisconnected}
            onValueChange={(v) => void patch({ notifyDisconnected: v })}
          />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
});
