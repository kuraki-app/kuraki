import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type AlertButton,
} from 'react-native';

import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, useTokens } from '@/constants/theme';
import { backupEngine } from '@/lib/backup-engine';
import { loadBackupReceipts } from '@/lib/backup-ledger';
import { verifyLocalReceipt } from '@/lib/reclaim-verification';
import {
  libraryKey,
  loadCaptureSettings,
  assertActiveConnection,
} from '@/lib/settings';
import { isAbort, throwIfAborted, abortable } from '@/lib/request';
import { formatBytes } from '@/lib/format';
import { usePrefs } from '@/hooks/use-prefs';
import { savePrefs } from '@/lib/prefs';
import {
  RETENTION_DAYS,
  reclaimSummary,
  reclaimable,
  type LocalAsset,
} from '@/lib/reclaim';

const RETENTION_LABELS: Record<number, string> = {
  [-1]: 'Keep all',
  7: '1 week',
  30: '1 month',
  90: '3 months',
  365: '1 year',
};

/**
 * Free up space removes the phone's copy of photos the server already has.
 *
 * Eligibility requires a library-scoped successful original receipt plus
 * matching current local and server bytes. Both are rechecked before removal.
 *
 * Retention is the second guard, defaulting to "Keep all" — a screen that
 * deletes photographs must be opted into, not merely visited.
 *
 * Deletion goes through `MediaLibrary.deleteAssetsAsync`, which raises the OS's
 * own confirmation. That is deliberate: the system dialog is the one users
 * recognise, and on iOS the photos land in Recently Deleted rather than
 * vanishing, so there is still a way back after all of this.
 */
export default function FreeUpSpaceSettings() {
  const tokens = useTokens();
  const { keepLocalDays } = usePrefs();
  const [scanning, setScanning] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletionLock = useRef(false);
  const [candidates, setCandidates] = useState<LocalAsset[] | null>(null);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  const scan = useCallback(async (days: number) => {
    if (deletionLock.current) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setScanning(true);
    setError('');
    try {
      const signal = controller.signal;
      if (days < 0) {
        setCandidates([]);
        return;
      }
      const settings = await loadCaptureSettings();
      if (!settings.serverID || !settings.ownerID || !settings.deviceToken)
        throw new Error(
          'Connect to your updated server before verifying local copies.',
        );
      const permission = await MediaLibrary.getPermissionsAsync(false, [
        'photo',
        'video',
      ]);
      if (!permission.granted)
        throw new Error(
          'Photo access is needed. Open Permissions in Settings.',
        );
      const verified: LocalAsset[] = [];
      let after: string | undefined;
      let skipped = 0;
      for (let pages = 0; pages < 20; pages++) {
        throwIfAborted(signal);
        const page = await MediaLibrary.getAssetsAsync({
          first: 100,
          after,
          mediaType: ['photo', 'video'],
        });
        const receipts = await loadBackupReceipts(
          libraryKey(settings),
          page.assets.map((a) => a.id),
        );
        const eligible = new Set(
          reclaimable(page.assets, new Set(receipts.keys()), days).map(
            (a) => a.id,
          ),
        );
        for (const asset of page.assets) {
          if (!eligible.has(asset.id)) continue;
          try {
            verified.push(
              await verifyLocalReceipt(
                settings,
                asset,
                receipts.get(asset.id)!,
                signal,
              ),
            );
          } catch (cause) {
            if (isAbort(cause) || signal.aborted) throw cause;
            skipped++;
          }
          if (verified.length >= 50) break;
        }
        if (!page.hasNextPage || verified.length >= 50) break;
        after = page.endCursor;
      }
      await assertActiveConnection(settings);
      throwIfAborted(signal);
      setCandidates(verified);
      if (skipped)
        setError(
          `${skipped} items could not be verified and will stay on this device.`,
        );
    } catch (cause) {
      if (isAbort(cause)) return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not verify your local copies.',
      );
      setCandidates([]);
    } finally {
      if (operation.current === controller) setScanning(false);
    }
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app. Re-scans whenever the
  // window changes, because that is the only thing that changes the answer.
  useEffect(() => {
    const timer = setTimeout(() => void scan(keepLocalDays), 0);
    return () => clearTimeout(timer);
  }, [scan, keepLocalDays]);

  /**
   * Back up everything outstanding first.
   *
   * Ordering matters and is the reason this button exists: anything not yet
   * uploaded is not in the ledger, so it is not offered for deletion. Running
   * a pass first is what turns "delete what is safe" into "delete what is
   * safe, having first made more of it safe".
   */
  async function backupFirst() {
    setBackingUp(true);
    setError('');
    try {
      await backupEngine.run();
    } catch {
      setError('Backup did not finish. Nothing was deleted.');
    } finally {
      setBackingUp(false);
      await scan(keepLocalDays);
    }
  }

  function confirmDelete() {
    if (!candidates || candidates.length === 0) return;
    const { count, bytes } = reclaimSummary(candidates);
    const body =
      `${count} item${count === 1 ? '' : 's'} will be removed from this device.` +
      (bytes > 0 ? ` About ${formatBytes(bytes)}.` : '') +
      ` Their current originals have been verified on your server.${Platform.OS === 'ios' ? ' iOS moves them to Recently Deleted first.' : ''}`;
    // Android's Alert ignores `style` and assigns roles by position — the LAST
    // button is the emphasised one — so Cancel goes last there and first on
    // iOS, leaving the destructive path de-emphasised on both.
    const buttons: AlertButton[] =
      Platform.OS === 'android'
        ? [
            {
              text: 'Remove from device',
              style: 'destructive',
              onPress: () => void remove(),
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove from device',
              style: 'destructive',
              onPress: () => void remove(),
            },
          ];
    Alert.alert('Remove local copies?', body, buttons);
  }

  async function remove() {
    if (!candidates || candidates.length === 0 || deletionLock.current) return;
    deletionLock.current = true;
    setDeleting(true);
    try {
      // The OS raises its own confirmation on top of ours and returns false if
      // the user declines there. That is not an error — it is the answer.
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      const signal = controller.signal;
      const settings = await loadCaptureSettings();
      if (!settings.serverID || !settings.ownerID || !settings.deviceToken)
        throw new Error(
          'Reconnect to verify originals before removing local copies.',
        );
      const receipts = await loadBackupReceipts(
        libraryKey(settings),
        candidates.map((a) => a.id),
      );
      // Refresh both local metadata/bytes and server bytes after our confirmation,
      // immediately before the OS takes over its deletion confirmation.
      for (const candidate of candidates) {
        const asset = await abortable(
          MediaLibrary.getAssetInfoAsync(candidate.id, {
            shouldDownloadFromNetwork: false,
          }),
          signal,
        );
        const receipt = receipts.get(candidate.id);
        if (!receipt)
          throw new Error('A backup receipt is missing. Nothing was removed.');
        await verifyLocalReceipt(settings, asset, receipt, signal);
      }
      throwIfAborted(signal);
      await assertActiveConnection(settings);
      const ok = await MediaLibrary.deleteAssetsAsync(
        candidates.map((a) => a.id),
      );
      if (!ok) return;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove the local copies.',
      );
    } finally {
      deletionLock.current = false;
      setDeleting(false);
      await scan(keepLocalDays);
    }
  }

  const summary = candidates ? reclaimSummary(candidates) : null;
  const busy = scanning || backingUp || deleting;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}
    >
      <SettingsSection
        title="Keep on this device"
        info={{
          message:
            'Only current local originals verified against your connected server are offered, up to 50 at a time. Keep all removes nothing. iCloud may sync photo removal across your devices.',
        }}
      >
        <View style={styles.choiceRow}>
          {RETENTION_DAYS.map((days) => {
            const active = days === keepLocalDays;
            return (
              <Pressable
                key={days}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => void savePrefs({ keepLocalDays: days })}
                style={[
                  styles.choice,
                  { borderColor: tokens.input },
                  active && {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                ]}
              >
                <ThemedText
                  type="small"
                  themeColor={active ? 'primaryForeground' : undefined}
                >
                  {RETENTION_LABELS[days] ?? `${days}d`}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </SettingsSection>

      <SettingsSection
        title="Safe to remove"
        info={{
          message:
            'Only items confirmed by the server are eligible. Anything waiting to upload stays on this phone.',
        }}
      >
        {error ? (
          <ThemedText
            type="small"
            style={{ color: tokens.destructive }}
            selectable
          >
            {error}
          </ThemedText>
        ) : null}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="mutedForeground">
              {deleting
                ? 'Verifying before removal…'
                : backingUp
                  ? 'Backing up what is left…'
                  : 'Checking your camera roll…'}
            </ThemedText>
          </View>
        ) : summary && summary.count > 0 ? (
          <ThemedText type="smallBold">
            {summary.count.toLocaleString()} item
            {summary.count === 1 ? '' : 's'} can be removed
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="mutedForeground">
            {keepLocalDays < 0
              ? 'Nothing, because Keep all is on. Choose a window above to see what could go.'
              : 'Nothing yet. Everything on this device is either newer than the window or not backed up.'}
          </ThemedText>
        )}

        <Pressable
          style={[
            styles.button,
            { borderColor: tokens.input },
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void backupFirst()}
        >
          <ThemedText type="smallBold">Back up everything first</ThemedText>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            {
              backgroundColor: tokens.destructive,
              borderColor: tokens.destructive,
            },
            (busy || !summary?.count) && styles.disabled,
          ]}
          disabled={busy || !summary?.count}
          onPress={confirmDelete}
        >
          <ThemedText type="smallBold" themeColor="primaryForeground">
            Remove local copies
          </ThemedText>
        </Pressable>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Space.seven },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.one,
    paddingTop: Space.one,
  },
  choice: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Space.one,
    paddingHorizontal: Space.two,
  },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.two,
    paddingVertical: Space.one,
  },
  button: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Space.two,
    marginTop: Space.two,
  },
  disabled: { opacity: 0.5 },
});
