import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View, type AlertButton } from 'react-native';

import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { backupEngine } from '@/lib/backup-engine';
import { loadBackedUpIds } from '@/lib/backup-ledger';
import { formatBytes } from '@/lib/format';
import { usePrefs } from '@/hooks/use-prefs';
import { savePrefs } from '@/lib/prefs';
import { RETENTION_DAYS, reclaimSummary, reclaimable, type LocalAsset } from '@/lib/reclaim';

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
 * The whole screen is built around one rule: **nothing is offered unless the
 * ledger says the server accepted it.** `loadBackedUpIds()` records an id only
 * after a successful upload, so "I think it uploaded" is never enough. See
 * `reclaimable` in lib/reclaim.ts, which is where that decision actually lives
 * and where it is tested.
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
  const [candidates, setCandidates] = useState<LocalAsset[] | null>(null);
  const [error, setError] = useState('');

  const scan = useCallback(async (days: number) => {
    setScanning(true);
    setError('');
    try {
      const permission = await MediaLibrary.getPermissionsAsync();
      if (!permission.granted) {
        setError('Photo access is off, so there is nothing to look at. Turn it on in Settings > Permissions.');
        setCandidates([]);
        return;
      }
      const backedUp = await loadBackedUpIds();
      // One pass over the roll. `first` is the library's page size; the ledger
      // is the filter, so there is no server round trip here at all — this
      // screen works offline, which matters because it is about the phone.
      const local: LocalAsset[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await MediaLibrary.getAssetsAsync({
          first: 500,
          after,
          mediaType: ['photo', 'video'],
        });
        for (const a of page.assets) {
          local.push({ id: a.id, creationTime: a.creationTime, size: undefined });
        }
        if (!page.hasNextPage) break;
        after = page.endCursor;
      }
      setCandidates(reclaimable(local, backedUp, days));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read your camera roll.');
      setCandidates([]);
    } finally {
      setScanning(false);
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
      ` They stay on your server.${Platform.OS === 'ios' ? ' iOS moves them to Recently Deleted first.' : ''}`;
    // Android's Alert ignores `style` and assigns roles by position — the LAST
    // button is the emphasised one — so Cancel goes last there and first on
    // iOS, leaving the destructive path de-emphasised on both.
    const buttons: AlertButton[] =
      Platform.OS === 'android'
        ? [
            { text: 'Remove from device', style: 'destructive', onPress: () => void remove() },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove from device', style: 'destructive', onPress: () => void remove() },
          ];
    Alert.alert('Remove local copies?', body, buttons);
  }

  async function remove() {
    if (!candidates || candidates.length === 0) return;
    try {
      // The OS raises its own confirmation on top of ours and returns false if
      // the user declines there. That is not an error — it is the answer.
      const ok = await MediaLibrary.deleteAssetsAsync(candidates.map((a) => a.id));
      if (!ok) return;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the local copies.');
    } finally {
      await scan(keepLocalDays);
    }
  }

  const summary = candidates ? reclaimSummary(candidates) : null;
  const busy = scanning || backingUp;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}>
      <SettingsSection
        title="Keep on this device"
        footer="Photos newer than this stay on your phone even once they are on the server. Keep all never removes anything.">
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
                  active && { backgroundColor: tokens.primary, borderColor: tokens.primary },
                ]}>
                <ThemedText type="small" themeColor={active ? 'primaryForeground' : undefined}>
                  {RETENTION_LABELS[days] ?? `${days}d`}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </SettingsSection>

      <SettingsSection
        title="Safe to remove"
        footer="Only photos your server has confirmed it holds are ever listed here. Anything still waiting to upload is left alone.">
        {error ? (
          <ThemedText type="small" style={{ color: tokens.destructive }} selectable>
            {error}
          </ThemedText>
        ) : null}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="mutedForeground">
              {backingUp ? 'Backing up what is left…' : 'Checking your camera roll…'}
            </ThemedText>
          </View>
        ) : summary && summary.count > 0 ? (
          <ThemedText type="smallBold">
            {summary.count.toLocaleString()} item{summary.count === 1 ? '' : 's'} can be removed
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="mutedForeground">
            {keepLocalDays < 0
              ? 'Nothing, because Keep all is on. Choose a window above to see what could go.'
              : 'Nothing yet. Everything on this device is either newer than the window or not backed up.'}
          </ThemedText>
        )}

        <Pressable
          style={[styles.button, { borderColor: tokens.input }, busy && styles.disabled]}
          disabled={busy}
          onPress={() => void backupFirst()}>
          <ThemedText type="smallBold">Back up everything first</ThemedText>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            { backgroundColor: tokens.destructive, borderColor: tokens.destructive },
            (busy || !summary?.count) && styles.disabled,
          ]}
          disabled={busy || !summary?.count}
          onPress={confirmDelete}>
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
  content: { paddingBottom: Spacing.five },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingTop: Spacing.one },
  choice: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  busy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  button: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    marginTop: Spacing.two,
  },
  disabled: { opacity: 0.5 },
});
