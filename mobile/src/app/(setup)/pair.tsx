import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function PairStep() {
  const tokens = useTokens();
  const [baseURL, setBaseURL] = useState('');
  const [token, setToken] = useState('');
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

  async function saveManualToken() {
    setError('');
    try {
      await saveCaptureSettings({ baseURL, deviceToken: token });
      router.push('/(setup)/permissions');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that token.');
    }
  }

  return (
    <ThemedView style={styles.content}>
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
        Or paste a device token from Kuraki&rsquo;s web app (Devices tab) by hand.
      </ThemedText>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Paste a device token"
        placeholderTextColor={tokens.textFaint}
        secureTextEntry
        value={token}
        onChangeText={setToken}
        style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
      />
      <Pressable
        disabled={!loaded || !token.trim() || !baseURL}
        onPress={() => void saveManualToken()}
        style={[styles.buttonGhost, { borderColor: tokens.input, opacity: loaded && token.trim() && baseURL ? 1 : 0.5 }]}>
        <ThemedText type="smallBold">Save token</ThemedText>
      </Pressable>
      {error ? <ThemedText themeColor="destructive">{error}</ThemedText> : null}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <PairScanner onPaired={onPaired} onClose={() => setScanning(false)} />
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: Spacing.two, minHeight: 48, paddingHorizontal: Spacing.two, fontSize: 16 },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, borderWidth: 1 },
});
