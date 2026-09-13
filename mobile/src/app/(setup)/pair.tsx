import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import SetupStep, { SetupButton, SetupCard, SetupField, SetupNotice } from '@/components/setup-step';
import { ThemedText } from '@/components/themed-text';
import { Space, useTokens } from '@/constants/theme';
import { claimPairing } from '@/lib/capture-api';
import { clearAuthLost } from '@/lib/session';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';
import { normalizeServerURL } from '@/lib/url';

export default function PairStep() {
  const tokens = useTokens();
  const [baseURL, setBaseURL] = useState('');
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadCaptureSettings().then((settings) => {
      setBaseURL(settings.baseURL);
      setLoaded(true);
    });
  }, []);

  // PairScanner claims and stores the device credential before this callback.
  function onPaired(scannedBaseURL: string) {
    setScanning(false);
    setBaseURL(scannedBaseURL);
    router.push('/(setup)/permissions');
  }

  async function claimManualCode() {
    if (!code.trim() || !baseURL) return;
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
    <SetupStep
      eyebrow="Pair securely"
      title="Link this phone"
      description="Scan the QR code in Kuraki Settings → Devices, or enter the code shown below it."
      symbol="qrcode.viewfinder"
      symbolFallback="03">
      <SetupCard>
        <ThemedText type="small" themeColor="textFaint">
          SERVER
        </ThemedText>
        <ThemedText type="code" selectable numberOfLines={2}>
          {baseURL || 'Loading server…'}
        </ThemedText>
      </SetupCard>

      <SetupButton label="Scan QR code" onPress={() => setScanning(true)} />

      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: tokens.border }]} />
        <ThemedText type="small" themeColor="textFaint">
          OR USE A CODE
        </ThemedText>
        <View style={[styles.line, { backgroundColor: tokens.border }]} />
      </View>
      <SetupField
        accessibilityLabel="Pairing code"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Pairing code"
        value={code}
        onChangeText={setCode}
        editable={!claiming}
        returnKeyType="go"
        onSubmitEditing={() => void claimManualCode()}
      />
      <SetupButton
        variant="secondary"
        disabled={!loaded || !code.trim() || !baseURL || claiming}
        onPress={() => void claimManualCode()}
        label={claiming ? 'Pairing…' : 'Pair with code'}
      />
      {error ? <SetupNotice tone="error">{error}</SetupNotice> : null}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <PairScanner onPaired={onPaired} onClose={() => setScanning(false)} />
      </Modal>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: Space.two },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
