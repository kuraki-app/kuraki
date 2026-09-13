import { router } from 'expo-router';
import { useState } from 'react';

import SetupStep, { SetupButton, SetupField, SetupNotice } from '@/components/setup-step';
import { ThemedText } from '@/components/themed-text';
import { DEFAULT_SERVER_PORT } from '@/design/ports';
import { resolveServerURL } from '@/lib/connection';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';
import { describeAddressGuess } from '@/lib/url';

export default function ServerStep() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function next() {
    if (!value.trim()) return;
    setBusy(true);
    setError('');
    try {
      // A bare hostname may be a LAN box or an HTTPS domain. Probe both and
      // retain the address that actually answers instead of guessing here.
      const baseURL = await resolveServerURL(value);
      if (!baseURL) {
        setError('Could not reach Kuraki. Check the address and make sure the server is running.');
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

  const portHint = describeAddressGuess(value, DEFAULT_SERVER_PORT);

  return (
    <SetupStep
      eyebrow="Connect"
      title="Find your server"
      description="Enter a local address or your Kuraki domain. We’ll detect the secure connection and port."
      symbol="internaldrive"
      symbolFallback="02">
      <SetupField
        accessibilityLabel="Kuraki server address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="192.168.1.40 or photos.example.com"
        value={value}
        onChangeText={setValue}
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => void next()}
      />
      <ThemedText type="small" themeColor="textFaint">
        {portHint}
      </ThemedText>
      {error ? <SetupNotice tone="error">{error}</SetupNotice> : null}
      <SetupButton
        disabled={busy || !value.trim()}
        onPress={() => void next()}
        label={busy ? 'Checking…' : 'Continue'}
      />
    </SetupStep>
  );
}
