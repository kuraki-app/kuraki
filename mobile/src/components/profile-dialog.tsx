import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import Dialog from '@/components/dialog';
import { SettingsRow } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { formatBytes } from '@/lib/format';
import { fetchStats, type LibraryStats } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

type Props = {
  visible: boolean;
  settings: CaptureSettings | null;
  onClose: () => void;
};

/**
 * ProfileDialog is what the Gallery header's profile item opens: how big the
 * library is, where it lives, what version is talking to it, and the two places
 * worth going from here.
 *
 * **It reports the library's size, not the disk's.** `/api/stats` counts the
 * owner's assets; nothing on the server reports filesystem space, so this
 * cannot answer "how much room is left" — the question someone opening a
 * storage panel most likely has. Answering it means a `Statfs` on the data dir
 * behind `//go:build unix` (with a fallback for the Windows cross-compile
 * target), a new field on `apitypes.LibraryStats`, and `make gen`. That was
 * weighed and deferred; it is a gap, not an oversight.
 */
export default function ProfileDialog({ visible, settings, onClose }: Props) {
  const tokens = useTokens();
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async (active: CaptureSettings) => {
    setFailed(false);
    try {
      setStats(await fetchStats(active));
    } catch {
      // Not fatal. The version and the server URL are the two things this
      // dialog can always answer, and they are worth more than an error screen
      // when the server is simply unreachable.
      setFailed(true);
    }
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app.
  useEffect(() => {
    if (!visible || !settings) return;
    const timer = setTimeout(() => void refresh(settings), 0);
    return () => clearTimeout(timer);
  }, [visible, settings, refresh]);

  // `nativeApplicationVersion` is absent in Expo Go, so the configured version
  // is the dependable source on every binary this ships as.
  const version = Constants.expoConfig?.version ?? 'unknown';

  function go(path: string) {
    onClose();
    router.push(path as Parameters<typeof router.push>[0]);
  }

  return (
    <Dialog visible={visible} title="Your library" onClose={onClose}>
      <View style={styles.body}>
        <ThemedText type="smallBold" style={[heading, styles.sectionTitle]}>
          Storage
        </ThemedText>
        {failed ? (
          <ThemedText type="small" themeColor="mutedForeground">
            Could not reach the server for library size.
          </ThemedText>
        ) : stats ? (
          <>
            <View style={styles.figure}>
              <ThemedText type="small" themeColor="mutedForeground">Kuraki library</ThemedText>
              <ThemedText type="smallBold" style={heading}>{formatBytes(stats.total_bytes)}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="mutedForeground">
              {stats.images.toLocaleString()} photo{stats.images === 1 ? '' : 's'} ·{' '}
              {stats.videos.toLocaleString()} video{stats.videos === 1 ? '' : 's'}
              {stats.trashed > 0 ? ` · ${stats.trashed.toLocaleString()} in trash` : ''}
            </ThemedText>
          </>
        ) : (
          <ThemedText type="small" themeColor="mutedForeground">Reading…</ThemedText>
        )}
      </View>

      <View style={[styles.rows, { borderTopColor: tokens.border }]}>
        <SettingsRow
          label="Free up space"
          icon="internaldrive"
          onPress={() => go('/(app)/settings/free-up-space')}
        />
        <SettingsRow label="Settings" icon="gearshape" onPress={() => go('/(app)/settings')} />
      </View>

      <View style={[styles.footer, { borderTopColor: tokens.border }]}>
        <ThemedText type="small" themeColor="mutedForeground">Kuraki {version}</ThemedText>
        <ThemedText type="small" themeColor="mutedForeground" numberOfLines={1} selectable>
          {settings?.baseURL ?? 'Not connected'}
        </ThemedText>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.half },
  sectionTitle: { paddingBottom: Spacing.half },
  figure: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  rows: { paddingHorizontal: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  footer: {
    padding: Spacing.three,
    gap: Spacing.half,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
