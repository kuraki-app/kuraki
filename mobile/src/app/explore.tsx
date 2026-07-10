import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';

export default function SettingsScreen() {
  const [baseURL, setBaseURL] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [saved, setSaved] = useState(false);

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

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <ThemedView style={styles.content}>
        <ThemedText type="title">Settings</ThemedText>
        <ThemedText themeColor="textSecondary" selectable>
          Create a device token in Kuraki’s web app, then paste it here. Then enable Automatic backup on the Backup tab. QR pairing and per-album selection are the next Capture milestones.
        </ThemedText>
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
