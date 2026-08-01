import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import AlbumPicker from '@/components/album-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { disableBackgroundBackup, enableBackgroundBackup, reconcileBackgroundBackup } from '@/lib/background';
import { backupEngine, type BackupProgress } from '@/lib/backup-engine';
import { getCaptureStatus, uploadPhoto, type CaptureStatus } from '@/lib/capture-api';
import { isAuthLost, onAuthLost } from '@/lib/session';
import { loadCaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

const registeredNote = 'Will also back up periodically in the background.';
const unavailableNote = 'Background backup is unavailable; runs while the app is open.';

type Props = {
  /**
   * Lets the host wire pull-to-refresh. Backup used to be its own screen and
   * owned the ScrollView; now that it is a section of Settings, the scroll
   * container belongs to the host, so the panel hands its refresh function
   * upward instead of losing the gesture entirely.
   */
  registerRefresh?: (refresh: () => Promise<void>) => void;
};

export default function BackupPanel({ registerRefresh }: Props) {
  const tokens = useTokens();
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [disconnected, setDisconnected] = useState(isAuthLost());

  useEffect(() => backupEngine.subscribe(setProgress), []);
  // Reflect the current auth-lost signal on any notification (not just set true)
  // so a recovery/re-pair clears the persistent disconnected notice.
  useEffect(() => onAuthLost(() => setDisconnected(isAuthLost())), []);

  // If automatic backup was left on, catch up in the foreground on open; the
  // engine ignores the call when a run is already in progress.
  const autoOn = progress?.auto ?? false;
  useEffect(() => {
    if (autoOn) void backupEngine.run();
  }, [autoOn]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getCaptureStatus(await loadCaptureSettings()));
      setError('');
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : 'Could not check backup status.');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    registerRefresh?.(refresh);
  }, [registerRefresh, refresh]);

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

  // The note previously appeared only as a result of tapping the switch, so a
  // user returning to this screen saw nothing at all -- including when
  // background backup was silently unavailable. Ask the OS for the truth.
  //
  // Deferred a tick (the places-screen/library pattern) so the setState does
  // not fire synchronously within the effect.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!autoOn) {
        setBgNote('');
        return;
      }
      void reconcileBackgroundBackup().then((state) => {
        if (!cancelled) setBgNote(state === 'registered' ? registeredNote : unavailableNote);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoOn]);

  const [pickingAlbums, setPickingAlbums] = useState(false);
  const albumCount = progress?.albumIds.length ?? 0;

  async function toggleAuto(next: boolean) {
    await backupEngine.setAuto(next);
    if (next) {
      const ok = await enableBackgroundBackup();
      setBgNote(ok ? registeredNote : unavailableNote);
    } else {
      await disableBackgroundBackup();
      setBgNote('');
    }
  }

  return (
    <>
      <ThemedView style={styles.content}>
        {disconnected && (
          // Deliberately not dismissible: unlike the Library banner, this must
          // never be hideable — a paired device silently not backing up is the
          // one state the user must always be able to see.
          <ThemedView style={[styles.banner, { backgroundColor: tokens.destructiveBg }]}>
            <ThemedText type="smallBold" style={{ color: tokens.destructive }}>
              This device is disconnected — your photos are not being backed up.
            </ThemedText>
            <ThemedText type="small" style={{ color: tokens.destructive }}>
              Use Re-pair below to reconnect and resume automatic backup.
            </ThemedText>
          </ThemedView>
        )}
        <ThemedText type="title" style={heading}>Backup</ThemedText>
        <ThemedText themeColor="mutedForeground" selectable>
          Your phone will show every item waiting for Kuraki, not just a generic sync spinner.
        </ThemedText>

        {error ? (
          <ThemedView type="card" style={styles.card}>
            <ThemedText type="subtitle" style={heading}>Connect this device</ThemedText>
            <ThemedText themeColor="mutedForeground" selectable>{error}</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="card" style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="subtitle" style={heading}>Automatic backup</ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                Back up new photos and videos from this phone.
              </ThemedText>
            </View>
            <Switch value={autoOn} onValueChange={(next) => void toggleAuto(next)} />
          </View>
          {progress?.permission === 'denied' && (
            <ThemedText type="small" themeColor="mutedForeground" selectable>
              Photo access is off. Enable it in system settings to back up automatically.
            </ThemedText>
          )}
          {bgNote ? (
            <ThemedText type="small" themeColor="mutedForeground" selectable>{bgNote}</ThemedText>
          ) : null}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="smallBold">Wi-Fi only</ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                Avoid using mobile data to upload.
              </ThemedText>
            </View>
            <Switch
              value={progress?.wifiOnly ?? true}
              onValueChange={(next) => void backupEngine.setWifiOnly(next)}
            />
          </View>
          <Pressable style={styles.albumRow} onPress={() => setPickingAlbums(true)}>
            <ThemedText type="small" themeColor="mutedForeground">Albums</ThemedText>
            <ThemedText type="smallBold">
              {albumCount ? `${albumCount} selected` : 'All photos & videos'}
            </ThemedText>
          </Pressable>
          <View style={styles.actions}>
            <Pressable
              disabled={running}
              style={[styles.buttonSmall, { backgroundColor: tokens.primary }]}
              onPress={() => void backupEngine.run()}>
              <ThemedText type="smallBold" themeColor="primaryForeground">
                {running ? 'Backing up…' : 'Back up new photos'}
              </ThemedText>
            </Pressable>
            {running && (
              <Pressable style={[styles.buttonGhost, { borderColor: tokens.input }]} onPress={() => backupEngine.stop()}>
                <ThemedText type="smallBold">Pause</ThemedText>
              </Pressable>
            )}
          </View>
          {progress?.message ? (
            <ThemedText type="small" themeColor="mutedForeground" selectable>
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
          <ThemedText type="small" themeColor="mutedForeground" selectable>
            Last backed up: {progress.lastSuccess.filename}
          </ThemedText>
        )}

        {progress?.failed.length ? (
          <ThemedView type="card" style={styles.card}>
            <View style={styles.row}>
              <ThemedText type="subtitle" style={heading}>Needs attention</ThemedText>
              <Pressable
                disabled={running}
                style={[styles.retryButton, { backgroundColor: tokens.primary }]}
                onPress={() => void backupEngine.run()}>
                <ThemedText type="smallBold" themeColor="primaryForeground">
                  {running ? 'Retrying…' : 'Retry now'}
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="mutedForeground">
              Retry checks the server offset and skips items already accepted by Kuraki.
            </ThemedText>
            {progress.failed.slice(0, 8).map((item) => (
              <View key={item.localId} style={styles.session}>
                <ThemedText selectable>{item.filename}</ThemedText>
                <ThemedText type="small" themeColor="mutedForeground" selectable>{item.error}</ThemedText>
              </View>
            ))}
          </ThemedView>
        ) : null}

        <ThemedView type="card" style={styles.card}>
          <ThemedText type="subtitle" style={heading}>Server activity</ThemedText>
          {status?.sessions.length ? (
            status.sessions.slice(0, 8).map((session) => (
              <View key={session.id} style={styles.session}>
                <ThemedText selectable>{session.filename}</ThemedText>
                <ThemedText type="small" themeColor="mutedForeground" selectable>
                  {session.status} · {Math.round((session.received_bytes / session.size_bytes) * 100)}%
                </ThemedText>
              </View>
            ))
          ) : (
            <ThemedText themeColor="mutedForeground">No recent uploads from this device.</ThemedText>
          )}
        </ThemedView>

        <Pressable
          disabled={isUploading}
          style={[styles.button, { backgroundColor: tokens.primary }]}
          onPress={() => void chooseAndUpload()}>
          <ThemedText type="smallBold" themeColor="primaryForeground">
            {isUploading ? 'Backing up…' : 'Choose a single photo'}
          </ThemedText>
        </Pressable>
        {uploading ? <ThemedText themeColor="mutedForeground" selectable>{uploading}</ThemedText> : null}
      </ThemedView>
      <Modal visible={pickingAlbums} animationType="slide" onRequestClose={() => setPickingAlbums(false)}>
        <AlbumPicker selected={progress?.albumIds ?? []} onClose={() => setPickingAlbums(false)} />
      </Modal>
    </>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <ThemedView type="card" style={styles.countCard}>
      <ThemedText style={styles.count} selectable>{value}</ThemedText>
      <ThemedText type="small" themeColor="mutedForeground">{label}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // No flex:1 — this is a section inside the Settings scroll view now, not a
  // screen root; stretching it would collapse the sections below it.
  content: { padding: Spacing.three, gap: Spacing.three },
  banner: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.half },
  counts: { flexDirection: 'row', gap: Spacing.two },
  countCard: { flex: 1, padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  count: { fontSize: 30, fontVariant: ['tabular-nums'] },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  albumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  rowText: { flex: 1, gap: Spacing.half },
  actions: { flexDirection: 'row', gap: Spacing.two },
  session: { gap: Spacing.half },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  buttonSmall: { flex: 1, alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderWidth: 1 },
  retryButton: { marginLeft: 'auto', borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
});
