import { router } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
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
    router.replace('/(app)');
  }

  return (
    <ThemedView style={styles.content}>
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, borderWidth: 1 },
});
