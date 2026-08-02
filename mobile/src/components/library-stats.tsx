import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { formatBytes, formatCount } from '@/lib/format';
import { fetchStats, type LibraryStats } from '@/lib/library-api';
import { loadCaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// LibraryStats is the top of Settings: how much is on the server and what it
// consists of. It fails quietly -- an unreachable server is already reported by
// the connection section, and a missing stats card must not push the settings
// list off the screen behind an error.
export default function LibraryStatsCard() {
  const [stats, setStats] = useState<LibraryStats | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await fetchStats(await loadCaptureSettings()));
    } catch {
      setStats(null);
    }
  }, []);

  // Deferred a tick, matching the pattern the other screens use so the first
  // setState does not fire synchronously inside the effect.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (!stats) return null;

  return (
    <View style={styles.wrap}>
      <ThemedView type="card" style={styles.card}>
        <ThemedText type="title" style={[heading, styles.size]}>
          {formatBytes(stats.total_bytes)}
        </ThemedText>
        <ThemedText type="small" themeColor="mutedForeground">
          {formatCount(stats.total)} items in your library
        </ThemedText>
        <View style={styles.counts}>
          <Stat label="Photos" value={stats.images} />
          <Stat label="Videos" value={stats.videos} />
          <Stat label="Albums" value={stats.albums} />
          <Stat label="Trash" value={stats.trashed} />
        </View>
      </ThemedView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold" style={styles.statValue}>
        {formatCount(value)}
      </ThemedText>
      <ThemedText type="small" themeColor="mutedForeground">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  card: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.half },
  size: { fontSize: 32, lineHeight: 38 },
  counts: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.two },
  stat: { gap: 2 },
  statValue: { fontVariant: ['tabular-nums'] },
});
