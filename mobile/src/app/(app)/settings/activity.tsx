import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { backupEngine, type BackupProgress } from '@/lib/backup-engine';
import { getCaptureStatus, type CaptureStatus } from '@/lib/capture-api';
import { loadCaptureSettings } from '@/lib/settings';

// Activity answers "what is this device doing, and what went wrong". It was
// buried at the bottom of the old single-page Backup screen, below every
// control, which is precisely where nobody looks when something is stuck.
export default function ActivitySettings() {
  const tokens = useTokens();
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => backupEngine.subscribe(setProgress), []);

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

  const failed = progress?.failed ?? [];
  const running = progress?.running ?? false;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <SettingsSection title="This device">
        <View style={styles.counts}>
          <Count label="Waiting" value={progress?.pending ?? 0} />
          <Count label="Backed up" value={progress?.done ?? 0} />
          <Count label="Failed" value={failed.length} />
        </View>
        {progress?.lastSuccess ? (
          <ThemedText type="small" themeColor="mutedForeground" selectable style={styles.line}>
            Last backed up: {progress.lastSuccess.filename}
          </ThemedText>
        ) : null}
      </SettingsSection>

      {failed.length ? (
        <SettingsSection
          title="Needs attention"
          footer="Retry checks the server offset and skips items Kuraki already accepted.">
          {failed.slice(0, 8).map((item) => (
            <View key={item.localId} style={styles.entry}>
              <ThemedText type="smallBold" selectable>
                {item.filename}
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground" selectable>
                {item.error}
              </ThemedText>
            </View>
          ))}
          <Pressable
            disabled={running}
            style={[styles.button, { backgroundColor: tokens.primary, opacity: running ? 0.5 : 1 }]}
            onPress={() => void backupEngine.run()}>
            <ThemedText type="smallBold" themeColor="primaryForeground">
              {running ? 'Retrying…' : 'Retry now'}
            </ThemedText>
          </Pressable>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Server activity" footer={error || undefined}>
        {status?.sessions.length ? (
          status.sessions.slice(0, 10).map((session) => (
            <View key={session.id} style={styles.entry}>
              <ThemedText type="smallBold" selectable>
                {session.filename}
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground" selectable>
                {session.status} ·{' '}
                {session.size_bytes > 0
                  ? `${Math.round((session.received_bytes / session.size_bytes) * 100)}%`
                  : '0%'}
              </ThemedText>
            </View>
          ))
        ) : (
          <ThemedText themeColor="mutedForeground" style={styles.line}>
            No recent uploads from this device.
          </ThemedText>
        )}
      </SettingsSection>
    </ScrollView>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.count}>
      <ThemedText type="title" style={styles.countValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="mutedForeground">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  counts: { flexDirection: 'row', gap: Spacing.five, paddingVertical: Spacing.two },
  count: { gap: 2 },
  countValue: { fontSize: 24, lineHeight: 30, fontVariant: ['tabular-nums'] },
  entry: { paddingVertical: Spacing.two, gap: 2 },
  line: { paddingVertical: Spacing.two },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.two, marginVertical: Spacing.two },
});
