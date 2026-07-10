import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { claimPairing } from '@/lib/capture-api';
import { clearAuthLost } from '@/lib/session';
import { saveCaptureSettings } from '@/lib/settings';

type Props = {
  onPaired: (baseURL: string) => void;
  onClose: () => void;
};

// PairScanner reads the QR the Kuraki web app shows. The QR carries the server
// URL and a one-time code; on a successful scan the phone claims its own device
// token and stores the connection, so the owner never types a token by hand.
export default function PairScanner({ onPaired, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Point the camera at the QR code in Kuraki › Devices.');

  async function handleScan(data: string) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = JSON.parse(data) as { base_url?: string; code?: string };
      if (!payload.base_url || !payload.code) throw new Error('That QR code is not a Kuraki pairing code.');
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
        <ThemedText themeColor="textSecondary" style={styles.msg}>
          Allow the camera to scan the pairing QR code.
        </ThemedText>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <ThemedText type="smallBold">Allow camera</ThemedText>
        </Pressable>
        <Pressable style={styles.ghost} onPress={onClose}>
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
        <Pressable style={styles.ghost} onPress={onClose}>
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
  button: { alignItems: 'center', borderRadius: 8, padding: 14, backgroundColor: '#cde7f7', minWidth: 180 },
  ghost: { alignItems: 'center', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#00000066', minWidth: 140 },
});
