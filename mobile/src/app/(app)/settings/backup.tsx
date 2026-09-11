import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import AlbumPicker from '@/components/album-picker';
import { uploadPhoto } from '@/lib/capture-api';
import { loadCaptureSettings } from '@/lib/settings';
import { BackupFailures, BackupProgressCard } from '@/components/backup-progress';
import { SettingsNotice, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import {
  disableBackgroundBackup,
  enableBackgroundBackup,
  reconcileBackgroundBackup,
} from '@/lib/background';
import { backupEngine, type BackupProgress } from '@/lib/backup-engine';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '@/lib/prefs';

const registeredNote = 'Will also back up periodically in the background.';
const unavailableNote = 'Background backup is unavailable; runs while the app is open.';

export default function BackupSettings() {
  const tokens = useTokens();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [bgNote, setBgNote] = useState('');
  const [pickingAlbums, setPickingAlbums] = useState(false);
  const [uploading, setUploading] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => backupEngine.subscribe(setProgress), []);

  useEffect(() => {
    const timer = setTimeout(() => void loadPrefs().then(setPrefs), 0);
    return () => clearTimeout(timer);
  }, []);

  const autoOn = progress?.auto ?? false;
  const running = progress?.running ?? false;
  const albumCount = progress?.albumIds.length ?? 0;

  // Ask the OS for the real registration state rather than only reflecting the
  // last tap, so a user returning here sees the truth.
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

  const patch = useCallback(async (next: Partial<Prefs>) => {
    setPrefs(await savePrefs(next));
  }, []);

  async function toggleAuto(next: boolean) {
    await backupEngine.setAuto(next);
    if (next) {
      setBgNote((await enableBackgroundBackup()) ? registeredNote : unavailableNote);
    } else {
      await disableBackgroundBackup();
      setBgNote('');
    }
  }

  // Send one photo now, independent of the automatic queue. Kept from the old
  // single-page Backup screen: it is the fastest way to prove a fresh pairing
  // works end to end without waiting for a scheduled run.
  async function chooseAndUpload() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: false,
      quality: 1,
    });
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
    } catch (cause) {
      setUploading(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  const nothingSelected = !prefs.backupPhotos && !prefs.backupVideos;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[styles.fill, { backgroundColor: tokens.background }]}
        contentContainerStyle={styles.content}>
        <BackupProgressCard progress={progress} />

        <SettingsSection
          title="What to back up"
          info={{ message: 'Choose which kinds of media are copied from this phone to your Kuraki server.' }}>
          <SettingsSwitch
            label="Photos"
            value={prefs.backupPhotos}
            onValueChange={(v) => void patch({ backupPhotos: v })}
          />
          <SettingsSwitch
            label="Videos"
            value={prefs.backupVideos}
            onValueChange={(v) => void patch({ backupVideos: v })}
          />
        </SettingsSection>

        {nothingSelected ? <SettingsNotice message="Turn on photos or videos to run a backup." tone="warning" /> : null}

        <SettingsSection
          title="Albums"
          info={{ message: 'When selected-album sync is off, the whole camera roll is eligible.' }}>
          <SettingsSwitch
            label="Only sync selected albums"
            value={prefs.syncAlbums}
            onValueChange={(v) => void patch({ syncAlbums: v })}
          />
          {prefs.syncAlbums ? (
            <SettingsRow
              label="Selected albums"
              detail={albumCount ? `${albumCount} selected` : 'None yet'}
              onPress={() => setPickingAlbums(true)}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="Automatic backup"
          info={{ message: 'Kuraki checks for new items in the background when the operating system allows it.' }}
          footer={bgNote || undefined}>
          <SettingsSwitch
            label="Automatic backup"
            value={autoOn}
            onValueChange={(v) => void toggleAuto(v)}
          />
          <SettingsSwitch
            label="Wi-Fi only"
            value={progress?.wifiOnly ?? true}
            onValueChange={(v) => void backupEngine.setWifiOnly(v)}
          />
        </SettingsSection>

        {progress?.permission === 'denied' ? (
          <SettingsNotice message="Photo access is off. Enable it in Settings › Permissions." tone="warning" />
        ) : null}

        <View style={styles.actions}>
          <Pressable
            disabled={running || nothingSelected}
            style={[
              styles.button,
              { backgroundColor: tokens.primary, opacity: running || nothingSelected ? 0.5 : 1 },
            ]}
            onPress={() => void backupEngine.run()}>
            <ThemedText type="smallBold" themeColor="primaryForeground">
              {running ? 'Backing up…' : 'Back up now'}
            </ThemedText>
          </Pressable>
          {running ? (
            <Pressable
              style={[styles.buttonGhost, { borderColor: tokens.input }]}
              onPress={() => backupEngine.stop()}>
              <ThemedText type="smallBold">Pause</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* Only when a run is *not* in flight: BackupProgressCard above covers
            the running case in full, and printing the same state twice made the
            page argue with itself. `message` still carries everything else the
            engine says — a network gate, an idle summary, a stop reason. */}
        {progress?.message && !running ? (
          <SettingsNotice message={progress.message} />
        ) : null}

        <BackupFailures failed={progress?.failed ?? []} />

        <SettingsSection
          title="Manual upload"
          info={{ message: 'Send one photo immediately without changing automatic backup.' }}
          footer={uploading || undefined}>
          <SettingsRow
            label={isUploading ? 'Uploading…' : 'Choose a photo'}
            icon="photo.badge.plus"
            onPress={isUploading ? undefined : () => void chooseAndUpload()}
          />
        </SettingsSection>
      </ScrollView>

      <Modal visible={pickingAlbums} animationType="slide" onRequestClose={() => setPickingAlbums(false)}>
        <AlbumPicker selected={progress?.albumIds ?? []} onClose={() => setPickingAlbums(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.four },
  button: { flex: 1, alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
  buttonGhost: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three, borderWidth: 1 },
});
