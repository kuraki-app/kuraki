import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTokens } from '@/constants/theme';
import { claimPairing } from '@/lib/capture-api';
import { decodePairingURI } from '@/lib/pairing';
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
  const tokens = useTokens();
  // This renders inside a full-screen Modal, so the insets are the window's.
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Point the camera at the QR code in Kuraki › Devices.');

  async function handleScan(data: string) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = decodePairingURI(data);
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
      {/* Sat at a hardcoded `bottom: 40`, which lands on the home indicator on
          a gesture-nav phone and floats well clear of the edge on one with
          buttons. */}
      <View style={[styles.overlay, { bottom: insets.bottom + 24 }]}>
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
  overlay: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  msg: { textAlign: 'center' },
  button: { alignItems: 'center', borderRadius: 8, padding: 14, minWidth: 180 },
  ghost: { alignItems: 'center', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, minWidth: 140 },
});
