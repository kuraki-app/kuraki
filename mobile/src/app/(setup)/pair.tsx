import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { claimPairing } from '@/lib/capture-api';
import { clearAuthLost } from '@/lib/session';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';
import { normalizeServerURL } from '@/lib/url';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function PairStep() {
  const tokens = useTokens();
  const [baseURL, setBaseURL] = useState('');
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadCaptureSettings().then((settings) => {
      setBaseURL(settings.baseURL);
      setLoaded(true);
    });
  }, []);

  // PairScanner already claims the device token and saves it (along with the
  // QR's own base URL) before calling us back — we only need to react to a
  // mismatch against the address confirmed on the previous step and move on.
  function onPaired(scannedBaseURL: string) {
    setScanning(false);
    if (baseURL && scannedBaseURL !== baseURL) {
      setNote(`Paired using the address from the QR code (${scannedBaseURL}), which differs from what you entered.`);
    }
    setBaseURL(scannedBaseURL);
    router.push('/(setup)/permissions');
  }

  // The typed path redeems the same one-time code the QR carries, through the
  // same claim endpoint — it is the QR path without the camera. It must never
  // just store what was typed: a pairing code is not a device token, and saving
  // one directly produced a device that looked paired and then 401'd forever.
  async function claimManualCode() {
    setError('');
    setClaiming(true);
    try {
      const server = normalizeServerURL(baseURL);
      const device = await claimPairing(server, code.trim(), Device.deviceName ?? 'My phone');
      await saveCaptureSettings({ baseURL: server, deviceToken: device.token });
      clearAuthLost();
      router.push('/(setup)/permissions');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not pair with that code.');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <SetupStep>
      <ThemedText type="title" style={heading}>
        Pair this phone
      </ThemedText>
      <ThemedText themeColor="textDim">Connecting to</ThemedText>
      <ThemedText type="code" selectable>
        {baseURL || 'No server address set yet.'}
      </ThemedText>

      <Pressable
        onPress={() => {
          setNote('');
          setScanning(true);
        }}
        style={[styles.button, { backgroundColor: tokens.primary }]}>
        <ThemedText type="smallBold" style={{ color: tokens.primaryForeground }}>
          Scan QR to pair
        </ThemedText>
      </Pressable>

      {note ? <ThemedText themeColor="mutedForeground">{note}</ThemedText> : null}

      <ThemedText themeColor="mutedForeground">
        Or type the pairing code shown under the QR in Kuraki&rsquo;s web app (Devices tab).
      </ThemedText>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Pairing code"
        placeholderTextColor={tokens.textFaint}
        value={code}
        onChangeText={setCode}
        editable={!claiming}
        style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
      />
      <Pressable
        disabled={!loaded || !code.trim() || !baseURL || claiming}
        onPress={() => void claimManualCode()}
        style={[
          styles.buttonGhost,
          { borderColor: tokens.input, opacity: loaded && code.trim() && baseURL && !claiming ? 1 : 0.5 },
        ]}>
        <ThemedText type="smallBold">{claiming ? 'Pairing…' : 'Pair with code'}</ThemedText>
      </Pressable>
      {error ? <ThemedText themeColor="destructive">{error}</ThemedText> : null}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <PairScanner onPaired={onPaired} onClose={() => setScanning(false)} />
      </Modal>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: Radius.sm, minHeight: 48, paddingHorizontal: Spacing.two, fontSize: 16 },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three, borderWidth: 1 },
});
