import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { clearMutations } from '@/lib/cache/mutations';
import { probeServer } from '@/lib/connection';
import { flushFavorites } from '@/lib/library-api';
import { clearAuthLost } from '@/lib/session';
import { clearDeviceToken, clearSetupComplete, loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function SettingsScreen() {
  const tokens = useTokens();
  const [baseURL, setBaseURL] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void loadCaptureSettings().then((settings) => {
      setBaseURL(settings.baseURL);
      setDeviceToken(settings.deviceToken);
    });
  }, []);

  // A save only counts as a "reconnect" once the server is actually reachable
  // with these credentials — otherwise a typo'd address would clear the auth-lost
  // banner and flush a queue that has nowhere to go. flushFavorites (shared with
  // Library's recovery path) drains the offline mutation queue over the link.
  async function tryReconnect(url: string, token: string) {
    if (!url || !token) return;
    const result = await probeServer(url);
    if (result === 'ok') {
      clearAuthLost();
      await flushFavorites({ baseURL: url, deviceToken: token });
    }
  }

  async function save() {
    await saveCaptureSettings({ baseURL, deviceToken });
    await tryReconnect(baseURL, deviceToken);
    setSaved(true);
  }

  function onPaired(url: string) {
    setScanning(false);
    setBaseURL(url);
    void loadCaptureSettings().then((s) => {
      setDeviceToken(s.deviceToken);
      void tryReconnect(url, s.deviceToken);
    });
    setSaved(true);
  }

  async function disconnect() {
    await clearDeviceToken();
    await clearSetupComplete();
    await clearMutations();
    router.replace('/(setup)/welcome');
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <ThemedView style={styles.content}>
        <ThemedText type="title" style={heading}>Settings</ThemedText>
        <ThemedText themeColor="mutedForeground" selectable>
          Scan the pairing QR from Kuraki’s web app (Devices tab), or paste a device token by hand. Then enable Automatic backup on the Backup tab.
        </ThemedText>
        <Pressable style={[styles.button, { backgroundColor: tokens.primary }]} onPress={() => setScanning(true)}>
          <ThemedText type="smallBold" themeColor="primaryForeground">Scan QR to pair</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">Server address</ThemedText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setBaseURL}
          placeholder="https://photos.example.com"
          style={[styles.input, { borderColor: tokens.input }]}
          value={baseURL}
        />
        <ThemedText type="smallBold">Device token</ThemedText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDeviceToken}
          placeholder="Paste the device token"
          secureTextEntry
          style={[styles.input, { borderColor: tokens.input }]}
          value={deviceToken}
        />
        <Pressable style={[styles.button, { backgroundColor: tokens.primary }]} onPress={() => void save()}>
          <ThemedText type="smallBold" themeColor="primaryForeground">Save connection</ThemedText>
        </Pressable>
        {saved && <ThemedText themeColor="mutedForeground" selectable>Saved securely on this device.</ThemedText>}

        <ThemedText type="smallBold" style={styles.disconnectHeading}>Library</ThemedText>
        <Pressable
          style={[styles.button, styles.row, { borderColor: tokens.input }]}
          onPress={() => router.push('/trash')}>
          <ThemedText type="smallBold">Trash</ThemedText>
          <ThemedText themeColor="mutedForeground">Restore or permanently delete items ›</ThemedText>
        </Pressable>

        <ThemedText type="smallBold" style={styles.disconnectHeading}>Danger zone</ThemedText>
        <ThemedText type="small" themeColor="mutedForeground" selectable>
          Disconnecting removes this device&rsquo;s pairing and sends it back through setup. Backed-up photos on
          the server are unaffected.
        </ThemedText>
        <Pressable
          style={[styles.button, styles.disconnectButton, { borderColor: tokens.destructive }]}
          onPress={() => void disconnect()}>
          <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Disconnect this device</ThemedText>
        </Pressable>
      </ThemedView>
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <PairScanner onPaired={onPaired} onClose={() => setScanning(false)} />
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two, flex: 1 },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1 },
  disconnectHeading: { marginTop: Spacing.three },
  disconnectButton: { borderWidth: 1 },
});
