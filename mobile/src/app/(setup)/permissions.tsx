import { router } from 'expo-router';
// Imported from the `legacy` entry point deliberately. The same functions
// re-exported from the package root are deprecated and documented as
// "will throw in runtime" -- they currently console.warn on every call,
// which is what surfaced a wall of deprecation text inside the Backup UI.
// The legacy entry is Expo's own documented target and is behaviour-identical;
// migrating to the new class-based API is a separate change that needs a
// device to verify, since it rewrites the backup scan path.
import * as MediaLibrary from 'expo-media-library/legacy';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { markSetupComplete } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function PermissionsStep() {
  const tokens = useTokens();
  const [status, setStatus] = useState<MediaLibrary.PermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestAccess() {
    setBusy(true);
    try {
      const result = await MediaLibrary.requestPermissionsAsync();
      setStatus(result.status);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await markSetupComplete();
    router.replace('/(app)/(gallery)');
  }

  return (
    <SetupStep>
      <ThemedText type="title" style={heading}>
        Photo access
      </ThemedText>
      <ThemedText themeColor="textDim">
        Kuraki needs access to your camera roll to back up new photos and videos automatically. Nothing leaves this
        phone except to your own server.
      </ThemedText>
      <Pressable disabled={busy} onPress={() => void requestAccess()} style={[styles.button, { backgroundColor: tokens.primary }]}>
        <ThemedText type="smallBold" style={{ color: tokens.primaryForeground }}>
          {busy ? 'Requesting…' : 'Allow photo access'}
        </ThemedText>
      </Pressable>
      {status ? (
        <ThemedText themeColor="mutedForeground">
          {status === 'granted'
            ? 'Photo access granted.'
            : status === 'undetermined'
              ? 'No response yet — you can allow access later in system settings.'
              : 'Photo access is off. You can enable it later in system settings to back up automatically.'}
        </ThemedText>
      ) : null}
      <Pressable onPress={() => void finish()} style={[styles.buttonGhost, { borderColor: tokens.input }]}>
        <ThemedText type="smallBold">Finish</ThemedText>
      </Pressable>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three, borderWidth: 1 },
});
