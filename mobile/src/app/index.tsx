import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { disableBackgroundBackup, enableBackgroundBackup } from '@/lib/background';
import { backupEngine, type BackupProgress } from '@/lib/backup-engine';
import { getCaptureStatus, uploadPhoto, type CaptureStatus } from '@/lib/capture-api';
import { loadCaptureSettings } from '@/lib/settings';

export default function BackupScreen() {
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => backupEngine.subscribe(setProgress), []);

  // If automatic backup was left on, catch up in the foreground on open; the
  // engine ignores the call when a run is already in progress.
  const autoOn = progress?.auto ?? false;
  useEffect(() => {
    if (autoOn) void backupEngine.run();
  }, [autoOn]);

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

  const running = progress?.running ?? false;
  const [bgNote, setBgNote] = useState('');

  async function toggleAuto(next: boolean) {
    await backupEngine.setAuto(next);
    if (next) {
      const ok = await enableBackgroundBackup();
      setBgNote(ok ? 'Will also back up periodically in the background.' : 'Background backup is unavailable; runs while the app is open.');
    } else {
      await disableBackgroundBackup();
      setBgNote('');
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
        ) : null}

        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="subtitle">Automatic backup</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Back up new photos and videos from this phone.
              </ThemedText>
            </View>
            <Switch value={autoOn} onValueChange={(next) => void toggleAuto(next)} />
          </View>
          {progress?.permission === 'denied' && (
            <ThemedText type="small" themeColor="textSecondary" selectable>
              Photo access is off. Enable it in system settings to back up automatically.
            </ThemedText>
          )}
          {bgNote ? (
            <ThemedText type="small" themeColor="textSecondary" selectable>{bgNote}</ThemedText>
          ) : null}
          <View style={styles.actions}>
            <Pressable disabled={running} style={styles.buttonSmall} onPress={() => void backupEngine.run()}>
              <ThemedText type="smallBold">{running ? 'Backing up…' : 'Back up new photos'}</ThemedText>
            </Pressable>
            {running && (
              <Pressable style={styles.buttonGhost} onPress={() => backupEngine.stop()}>
                <ThemedText type="smallBold">Pause</ThemedText>
              </Pressable>
            )}
          </View>
          {progress?.message ? (
            <ThemedText type="small" themeColor="textSecondary" selectable>
              {running && progress.currentFile
                ? `${progress.currentFile} · ${progress.currentPercent}%`
                : progress.message}
            </ThemedText>
          ) : null}
        </ThemedView>

        <View style={styles.counts}>
          <StatusCard label="Waiting" value={progress?.pending ?? 0} />
          <StatusCard label="Backed up" value={progress?.done ?? 0} />
          <StatusCard label="Needs attention" value={progress?.failed.length ?? 0} />
        </View>

        {progress?.lastSuccess && (
          <ThemedText type="small" themeColor="textSecondary" selectable>
            Last backed up: {progress.lastSuccess.filename}
          </ThemedText>
        )}

        {progress?.failed.length ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Needs attention</ThemedText>
            {progress.failed.slice(0, 8).map((item) => (
              <View key={item.localId} style={styles.session}>
                <ThemedText selectable>{item.filename}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" selectable>{item.error}</ThemedText>
              </View>
            ))}
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle">Server activity</ThemedText>
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

        <Pressable disabled={isUploading} style={styles.button} onPress={() => void chooseAndUpload()}>
          <ThemedText type="smallBold">{isUploading ? 'Backing up…' : 'Choose a single photo'}</ThemedText>
        </Pressable>
        {uploading ? <ThemedText themeColor="textSecondary" selectable>{uploading}</ThemedText> : null}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowText: { flex: 1, gap: Spacing.half },
  actions: { flexDirection: 'row', gap: Spacing.two },
  session: { gap: Spacing.half },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: '#cde7f7' },
  buttonSmall: { flex: 1, alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: '#cde7f7' },
  buttonGhost: { alignItems: 'center', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderWidth: 1, borderColor: '#b8b9be' },
});
