import * as Device from 'expo-device';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { claimPairing } from '@/lib/capture-api';
import { clearAuthLost } from '@/lib/session';
import { saveCaptureSettings } from '@/lib/settings';
import { normalizeServerURL } from '@/lib/url';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

type Props = {
  visible: boolean;
  /** Address used when a code is typed; a QR carries its own. */
  baseURL: string;
  onClose: () => void;
  onPaired: (baseURL: string) => void;
};

/**
 * PairSheet is the only place in the app that accepts a pairing secret, and it
 * only ever accepts one — nothing here renders a token or a code back to the
 * user. Both routes end at the same claim endpoint: scanning reads the address
 * and code from the QR, typing uses the address already configured.
 */
export default function PairSheet({ visible, baseURL, onClose, onPaired }: Props) {
  const tokens = useTokens();
  const [mode, setMode] = useState<'choose' | 'scan' | 'code'>('choose');
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setMode('choose');
    setCode('');
    setError('');
    onClose();
  }

  async function claimCode() {
    setError('');
    setClaiming(true);
    try {
      const server = normalizeServerURL(baseURL);
      const device = await claimPairing(server, code.trim(), Device.deviceName ?? 'My phone');
      await saveCaptureSettings({ baseURL: server, deviceToken: device.token });
      clearAuthLost();
      setCode('');
      setMode('choose');
      onPaired(server);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not pair with that code.');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      {mode === 'scan' ? (
        <PairScanner
          onPaired={(url) => {
            setMode('choose');
            onPaired(url);
          }}
          onClose={() => setMode('choose')}
        />
      ) : (
        <ThemedView style={styles.content}>
          <ThemedText type="title" style={heading}>
            Re-pair this device
          </ThemedText>
          <ThemedText themeColor="mutedForeground" selectable>
            Open Kuraki&rsquo;s web app on your computer and go to Settings &rsaquo; Devices, then generate a
            pairing code.
          </ThemedText>

          {mode === 'choose' ? (
            <>
              <Pressable
                style={[styles.button, { backgroundColor: tokens.primary }]}
                onPress={() => setMode('scan')}>
                <ThemedText type="smallBold" themeColor="primaryForeground">
                  Scan QR code
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.buttonGhost, { borderColor: tokens.input }]}
                onPress={() => setMode('code')}>
                <ThemedText type="smallBold">Enter pairing code</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="mutedForeground">
                Connecting to {baseURL || 'no address set'}
              </ThemedText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                editable={!claiming}
                onChangeText={setCode}
                placeholder="Pairing code"
                placeholderTextColor={tokens.textFaint}
                style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
                value={code}
              />
              <Pressable
                disabled={!code.trim() || !baseURL || claiming}
                style={[
                  styles.button,
                  {
                    backgroundColor: tokens.primary,
                    opacity: code.trim() && baseURL && !claiming ? 1 : 0.5,
                  },
                ]}
                onPress={() => void claimCode()}>
                <ThemedText type="smallBold" themeColor="primaryForeground">
                  {claiming ? 'Pairing…' : 'Pair with code'}
                </ThemedText>
              </Pressable>
              <Pressable style={styles.link} onPress={() => setMode('choose')}>
                <ThemedText type="small" themeColor="mutedForeground">
                  Scan a QR code instead
                </ThemedText>
              </Pressable>
            </>
          )}

          {error ? (
            <ThemedText themeColor="destructive" selectable>
              {error}
            </ThemedText>
          ) : null}

          <View style={styles.spacer} />
          <Pressable style={[styles.buttonGhost, { borderColor: tokens.input }]} onPress={close}>
            <ThemedText type="smallBold">Cancel</ThemedText>
          </Pressable>
        </ThemedView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  input: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three, borderWidth: 1 },
  link: { alignItems: 'center', paddingVertical: Spacing.two },
  spacer: { height: Spacing.three },
});
