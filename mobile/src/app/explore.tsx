import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import PairScanner from '@/components/pair-scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';

export default function SettingsScreen() {
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

  async function save() {
    await saveCaptureSettings({ baseURL, deviceToken });
    setSaved(true);
  }

  function onPaired(url: string) {
    setScanning(false);
    setBaseURL(url);
    void loadCaptureSettings().then((s) => setDeviceToken(s.deviceToken));
    setSaved(true);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <ThemedView style={styles.content}>
        <ThemedText type="title">Settings</ThemedText>
        <ThemedText themeColor="textSecondary" selectable>
          Scan the pairing QR from Kuraki’s web app (Devices tab), or paste a device token by hand. Then enable Automatic backup on the Backup tab.
        </ThemedText>
        <Pressable style={styles.button} onPress={() => setScanning(true)}>
          <ThemedText type="smallBold">Scan QR to pair</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">Server address</ThemedText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setBaseURL}
          placeholder="https://photos.example.com"
          style={styles.input}
          value={baseURL}
        />
        <ThemedText type="smallBold">Device token</ThemedText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDeviceToken}
          placeholder="Paste the device token"
          secureTextEntry
          style={styles.input}
          value={deviceToken}
        />
        <Pressable style={styles.button} onPress={() => void save()}>
          <ThemedText type="smallBold">Save connection</ThemedText>
        </Pressable>
        {saved && <ThemedText themeColor="textSecondary" selectable>Saved securely on this device.</ThemedText>}
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
    borderColor: '#b8b9be',
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: '#cde7f7' },
});
