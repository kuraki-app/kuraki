import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCaptureStatus, uploadPhoto, type CaptureStatus } from '@/lib/capture-api';
import { loadCaptureSettings } from '@/lib/settings';

export default function BackupScreen() {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await getCaptureStatus(await loadCaptureSettings()));
      setError('');
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : 'Could not check backup status.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function chooseAndUpload() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const filename = asset.fileName ?? asset.uri.split('/').pop() ?? `photo-${Date.now()}.jpg`;
    try {
      setIsUploading(true);
      setUploading('Preparing photo…');
      await uploadPhoto(await loadCaptureSettings(), { uri: asset.uri, filename }, (completed, total) => {
        setUploading(`Uploading ${Math.round((completed / total) * 100)}%`);
      });
      setUploading('Queued for Kuraki import.');
      await refresh();
    } catch (cause) {
      setUploading(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ThemedView style={styles.content}>
        <ThemedText type="title">Backup</ThemedText>
        <ThemedText themeColor="textSecondary" selectable>
          Your phone will show every item waiting for Kuraki, not just a generic sync spinner.
        </ThemedText>
        {error ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Connect this device</ThemedText>
            <ThemedText themeColor="textSecondary" selectable>{error}</ThemedText>
          </ThemedView>
        ) : (
          <>
            <View style={styles.counts}>
              <StatusCard label="Uploading" value={status?.receiving ?? 0} />
              <StatusCard label="Queued" value={status?.queued ?? 0} />
              <StatusCard label="Needs attention" value={status?.failed ?? 0} />
            </View>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="subtitle">Recent activity</ThemedText>
              {status?.sessions.length ? (
                status.sessions.slice(0, 8).map((session) => (
                  <View key={session.id} style={styles.session}>
                    <ThemedText selectable>{session.filename}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" selectable>
                      {session.status} · {Math.round((session.received_bytes / session.size_bytes) * 100)}%
                    </ThemedText>
                  </View>
                ))
              ) : (
                <ThemedText themeColor="textSecondary">No recent uploads from this device.</ThemedText>
              )}
            </ThemedView>
          </>
        )}
        <Pressable style={styles.button} onPress={refresh}>
          <ThemedText type="smallBold">Refresh status</ThemedText>
        </Pressable>
        <Pressable disabled={isUploading} style={styles.button} onPress={() => void chooseAndUpload()}>
          <ThemedText type="smallBold">{isUploading ? 'Backing up…' : 'Choose photo to back up'}</ThemedText>
        </Pressable>
        {uploading && <ThemedText themeColor="textSecondary" selectable>{uploading}</ThemedText>}
      </ThemedView>
    </ScrollView>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <ThemedView type="backgroundElement" style={styles.countCard}>
      <ThemedText style={styles.count} selectable>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, flex: 1 },
  counts: { flexDirection: 'row', gap: Spacing.two },
  countCard: { flex: 1, padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  count: { fontSize: 30, fontVariant: ['tabular-nums'] },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  session: { gap: Spacing.half },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: '#cde7f7' },
});
