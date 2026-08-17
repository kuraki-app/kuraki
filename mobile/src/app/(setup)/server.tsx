import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
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

  // Mirrors normalizeServerURL: a bare host gets :3000, anything with an
  // explicit port or scheme is left alone.
  const typedPort = /:\d+/.test(value.replace(/^\w+:\/\//, ''));
  const portHint = value.trim() === ''
    ? 'Port 3000 is added automatically — add your own (like :8080) if the server uses a different one.'
    : typedPort
      ? 'Using the port you entered.'
      : 'Port 3000 will be added automatically.';

  return (
    <SetupStep>
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
      {/* Says what normalizeServerURL is about to do, before it does it. "we
          will add the rest" above is vague about WHICH rest — someone typing a
          bare IP cannot tell whether they still need :3000, and someone whose
          server is on another port needs to know their :8080 is respected. */}
      <ThemedText type="small" themeColor="textFaint">
        {portHint}
      </ThemedText>
      {error ? <ThemedText themeColor="destructive">{error}</ThemedText> : null}
      <Pressable disabled={busy} onPress={() => void next()} style={[styles.button, { backgroundColor: tokens.primary }]}>
        <ThemedText type="smallBold" style={{ color: tokens.primaryForeground }}>
          {busy ? 'Checking…' : 'Continue'}
        </ThemedText>
      </Pressable>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: Radius.sm, minHeight: 48, paddingHorizontal: Spacing.two, fontSize: 16 },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
});
