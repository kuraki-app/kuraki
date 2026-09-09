import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { resolveServerURL } from '@/lib/connection';
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

  // Says what the address will be resolved to, before it is. The old hint
  // promised a port would be added for everything, which was a lie for a domain
  // on a reverse proxy — and the person typing one had no way to tell that the
  // failure they then got was the app's assumption rather than their address.
  const bare = value.trim().replace(/^\w+:\/\//, '');
  const typedScheme = /^https?:\/\//i.test(value.trim());
  const typedPort = /:\d+/.test(bare);
  const looksPublic = bare.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}/.test(bare)
    && !/\.(local|lan|home|internal|localdomain)(\/|$)/.test(bare);
  const portHint = value.trim() === ''
    ? `A local address gets port ${DEFAULT_SERVER_PORT} automatically; a domain name is tried over HTTPS first.`
    : typedScheme || typedPort
      ? 'Using the address exactly as you entered it.'
      : looksPublic
        ? `Trying https:// first, then port ${DEFAULT_SERVER_PORT}.`
        : `Port ${DEFAULT_SERVER_PORT} will be added automatically.`;

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
      {/* Says what normalizeServerURL is about to do, before it does it. "we
          will add the rest" above is vague about WHICH rest — someone typing a
          bare IP cannot tell whether they still need a port, and someone whose
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
