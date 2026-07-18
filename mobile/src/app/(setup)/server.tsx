import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { probeServer } from '@/lib/connection';
import { normalizeServerURL } from '@/lib/url';
import { saveCaptureSettings, loadCaptureSettings } from '@/lib/settings';

export default function ServerStep() {
  const tokens = useTokens();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function next() {
    setBusy(true);
    setError('');
    try {
      const baseURL = normalizeServerURL(value);
      const reach = await probeServer(baseURL);
      if (reach !== 'ok') {
        setError('Could not reach a Kuraki server at that address. Check the address and that the server is running.');
        return;
      }
      const existing = await loadCaptureSettings();
      await saveCaptureSettings({ baseURL, deviceToken: existing.deviceToken });
      router.push('/(setup)/pair');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That address did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.content}>
      <ThemedText type="title">Your server</ThemedText>
      <ThemedText themeColor="textDim">
        Enter your Kuraki server address. A local IP like 192.168.1.40 is fine — we will add the rest.
      </ThemedText>
      <TextInput
        autoCapitalize="none" autoCorrect={false} keyboardType="url"
        placeholder="192.168.1.40" placeholderTextColor={tokens.textFaint}
        value={value} onChangeText={setValue}
        style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
      />
      {error ? <ThemedText themeColor="destructive">{error}</ThemedText> : null}
      <Pressable disabled={busy} onPress={() => void next()} style={[styles.button, { backgroundColor: tokens.primary }]}>
        <ThemedText type="smallBold" style={{ color: tokens.primaryForeground }}>
          {busy ? 'Checking…' : 'Continue'}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: Spacing.two, minHeight: 48, paddingHorizontal: Spacing.two, fontSize: 16 },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
});
