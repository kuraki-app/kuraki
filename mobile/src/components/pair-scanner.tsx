import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTokens } from '@/constants/theme';
import { claimPairing } from '@/lib/capture-api';
import { clearAuthLost } from '@/lib/session';
import { saveCaptureSettings } from '@/lib/settings';

type Props = {
  onPaired: (baseURL: string) => void;
  onClose: () => void;
};

const PAIR_PREFIX = 'kuraki://pair?d=';

// decodePairing reads the app-only QR format `kuraki://pair?d=<base64url(JSON)>`.
// The payload is deliberately opaque so a generic QR reader reveals nothing
// usable — only this app knows to decode it. Returns the server URL and the
// one-time code the phone redeems for its own device token.
function decodePairing(data: string): { base_url: string; code: string } {
  const invalid = new Error('That QR code is not a Kuraki pairing code.');
  if (!data.startsWith(PAIR_PREFIX)) throw invalid;
  let b64 = data.slice(PAIR_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '='; // restore stripped base64 padding
  let payload: { base_url?: string; code?: string };
  try {
    payload = JSON.parse(atob(b64));
  } catch {
    throw invalid;
  }
  if (!payload.base_url || !payload.code) throw invalid;
  return { base_url: payload.base_url, code: payload.code };
}

// PairScanner reads the QR the Kuraki web app shows. The QR carries the server
// URL and a one-time code; on a successful scan the phone claims its own device
// token and stores the connection, so the owner never types a token by hand.
export default function PairScanner({ onPaired, onClose }: Props) {
  const tokens = useTokens();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Point the camera at the QR code in Kuraki › Devices.');

  async function handleScan(data: string) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = decodePairing(data);
      const name = Device.deviceName ?? 'My phone';
      const device = await claimPairing(payload.base_url, payload.code, name);
      const baseURL = payload.base_url.replace(/\/+$/, '');
      await saveCaptureSettings({ baseURL, deviceToken: device.token });
      clearAuthLost();
      onPaired(baseURL);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not pair with that code.');
      setBusy(false);
    }
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ThemedText>Preparing camera…</ThemedText>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <ThemedText type="subtitle">Camera access needed</ThemedText>
        <ThemedText themeColor="mutedForeground" style={styles.msg}>
          Allow the camera to scan the pairing QR code.
        </ThemedText>
        <Pressable style={[styles.button, { backgroundColor: tokens.primary }]} onPress={() => void requestPermission()}>
          <ThemedText type="smallBold" themeColor="primaryForeground">Allow camera</ThemedText>
        </Pressable>
        <Pressable style={[styles.ghost, { backgroundColor: tokens.scrim }]} onPress={onClose}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => void handleScan(data)}
      />
      <View style={styles.overlay}>
        <ThemedText style={styles.msg} selectable>{busy ? 'Pairing…' : message}</ThemedText>
        <Pressable style={[styles.ghost, { backgroundColor: tokens.scrim }]} onPress={onClose}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  msg: { textAlign: 'center' },
  button: { alignItems: 'center', borderRadius: 8, padding: 14, minWidth: 180 },
  ghost: { alignItems: 'center', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, minWidth: 140 },
});
