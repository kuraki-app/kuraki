import { useCallback, useEffect, useState } from 'react';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsNotice, SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { backupEngine, type BackupProgress } from '@/lib/backup-engine';
import { getCaptureStatus, type CaptureSession, type CaptureStatus } from '@/lib/capture-api';
import { formatBytes, formatCount } from '@/lib/format';
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
  const state = failed.length ? 'Needs attention' : running ? 'Backing up' : 'Up to date';
  const stateSymbol: SFSymbol = failed.length
    ? 'exclamationmark.triangle.fill'
    : running
      ? 'arrow.triangle.2.circlepath'
      : 'checkmark.circle.fill';
  const stateColor = failed.length ? tokens.warn : running ? tokens.mutedForeground : tokens.ok;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: tokens.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={tokens.mutedForeground} onRefresh={() => void refresh()} />}>
      <SettingsSection
        title="This device"
        info={{ message: 'Waiting and failed items are retried safely. Kuraki resumes large files from the last accepted byte.' }}>
        <View style={styles.summary}>
          <View style={styles.stateRow}>
            <SymbolView
              name={stateSymbol}
              size={22}
              tintColor={stateColor}
              fallback={<ThemedText style={{ color: stateColor }}>●</ThemedText>}
            />
            <ThemedText style={styles.stateLabel}>{state}</ThemedText>
          </View>
          <View style={styles.counts}>
            <Count label="Waiting" value={progress?.pending ?? 0} />
            <Count label="Done" value={progress?.done ?? 0} />
            <Count label="Failed" value={failed.length} warning={failed.length > 0} />
          </View>
        </View>
        {progress?.lastSuccess ? (
          <ActivityRow
            symbol="checkmark.circle"
            title={progress.lastSuccess.filename}
            detail="Last backed up"
          />
        ) : null}
      </SettingsSection>

      {failed.length ? (
        <SettingsSection
          title="Needs attention"
          info={{ message: 'Retry checks the server first and skips anything it has already accepted.' }}>
          {failed.slice(0, 8).map((item) => (
            <ActivityRow
              key={item.localId}
              symbol="exclamationmark.triangle"
              title={item.filename}
              detail={item.error}
              warning
            />
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

      {error ? <SettingsNotice message={error} tone="error" /> : null}

      <SettingsSection
        title="Recent uploads"
        info={{ message: 'This list reflects upload sessions recorded by your server for this device.' }}>
        {status?.sessions.length ? (
          status.sessions.slice(0, 10).map((session) => <SessionRow key={session.id} session={session} />)
        ) : (
          <View style={styles.empty}>
            <SymbolView
              name="tray"
              size={24}
              tintColor={tokens.textFaint}
              fallback={<ThemedText themeColor="textFaint">—</ThemedText>}
            />
            <ThemedText type="small" themeColor="mutedForeground">No recent uploads</ThemedText>
          </View>
        )}
      </SettingsSection>
    </ScrollView>
  );
}

function Count({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  const tokens = useTokens();
  return (
    <View style={styles.count}>
      <ThemedText style={[styles.countValue, { fontFamily: FontFamily.mono, color: warning ? tokens.warn : tokens.foreground }]}>
        {formatCount(value)}
      </ThemedText>
      <ThemedText type="small" themeColor="mutedForeground">
        {label}
      </ThemedText>
    </View>
  );
}

function ActivityRow({
  symbol,
  title,
  detail,
  warning = false,
}: {
  symbol: SFSymbol;
  title: string;
  detail: string;
  warning?: boolean;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.entry}>
      <SymbolView
        name={symbol}
        size={18}
        tintColor={warning ? tokens.warn : tokens.mutedForeground}
        fallback={<View style={styles.iconSpace} />}
      />
      <View style={styles.entryText}>
        <ThemedText type="smallBold" numberOfLines={1} selectable>{title}</ThemedText>
        <ThemedText type="small" themeColor="mutedForeground" numberOfLines={2} selectable>{detail}</ThemedText>
      </View>
    </View>
  );
}

function SessionRow({ session }: { session: CaptureSession }) {
  const tokens = useTokens();
  const total = Math.max(0, session.size_bytes);
  const received = Math.min(total, Math.max(0, session.received_bytes));
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const active = session.status === 'receiving' || session.status === 'uploading';
  const failed = session.status === 'failed';
  const detail = failed && session.error
    ? session.error
    : total > 0
      ? `${formatBytes(received)} of ${formatBytes(total)} · ${percent}%`
      : readableStatus(session.status);

  return (
    <View style={styles.session}>
      <View style={styles.sessionHead}>
        <ActivityRow
          symbol={failed ? 'xmark.circle' : active ? 'arrow.up.circle' : 'checkmark.circle'}
          title={session.filename}
          detail={detail}
          warning={failed}
        />
        <ThemedText style={[styles.badge, { color: failed ? tokens.destructive : tokens.mutedForeground }]}>
          {readableStatus(session.status)}
        </ThemedText>
      </View>
      {active && total > 0 ? (
        <View style={[styles.track, { backgroundColor: tokens.secondary }]}>
          <View style={[styles.trackFill, { width: `${percent}%`, backgroundColor: tokens.highlight }]} />
        </View>
      ) : null}
    </View>
  );
}

function readableStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  content: { paddingBottom: Space.seven },
  summary: { paddingVertical: Space.two, gap: Space.four },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Space.two },
  stateLabel: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  counts: { flexDirection: 'row', gap: Space.two },
  count: { flex: 1, minWidth: 0, gap: 2 },
  countValue: { fontSize: 24, lineHeight: 30, fontVariant: ['tabular-nums'] },
  entry: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Space.two, gap: Space.two },
  entryText: { flex: 1, minWidth: 0, gap: 2 },
  iconSpace: { width: 18 },
  session: { gap: Space.half },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: Space.one },
  badge: { fontFamily: FontFamily.mono, fontSize: 11, lineHeight: 16, textTransform: 'uppercase' },
  track: { height: 4, marginLeft: 18 + Space.two, marginBottom: Space.one, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 2 },
  empty: { alignItems: 'center', gap: Space.one, paddingVertical: Space.five },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Space.two, marginVertical: Space.two },
});
