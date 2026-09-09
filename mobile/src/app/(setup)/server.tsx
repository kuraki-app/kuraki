import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { resolveServerURL } from '@/lib/connection';
import { describeAddressGuess } from '@/lib/url';
import { DEFAULT_SERVER_PORT } from '@/design/ports';
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
      // resolveServerURL, not normalizeServerURL: a bare hostname does not say
      // whether this is a box on the LAN or a domain behind a reverse proxy, so
      // the probe decides rather than the guess.
      const baseURL = await resolveServerURL(value);
      if (!baseURL) {
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

  // The hint is a tested function in lib/url.ts, not inline logic: it is read
  // continuously while someone types, so it has to be right at every prefix.
  const portHint = describeAddressGuess(value, DEFAULT_SERVER_PORT);

  return (
    <SetupStep>
      <ThemedText type="title">Your server</ThemedText>
      <ThemedText themeColor="textDim">
        Enter your Kuraki server address. A local IP like 192.168.1.40 or a domain like
        photos.example.com both work — we will add the rest.
      </ThemedText>
      <TextInput
        autoCapitalize="none" autoCorrect={false} keyboardType="url"
        placeholder="192.168.1.40" placeholderTextColor={tokens.textFaint}
        value={value} onChangeText={setValue}
        style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
      />
      {/* "we will add the rest" above is vague about WHICH rest — someone
          typing a bare IP cannot tell whether they still need a port, and
          someone whose server is on another port needs to know their :8080 is
          respected. describeAddressGuess answers both, at every prefix. */}
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
