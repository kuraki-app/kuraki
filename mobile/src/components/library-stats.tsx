import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { formatBytes, formatCount } from '@/lib/format';
import { fetchStats, type LibraryStats } from '@/lib/library-api';
import { loadCaptureSettings } from '@/lib/settings';
import { serverHost } from '@/lib/url';

// LibraryStats is the top of Settings: how much is on the server and what it
// consists of. It fails quietly -- an unreachable server is already reported by
// the connection section, and a missing stats card must not push the settings
// list off the screen behind an error.
//
// This is the Vault register at its most literal: a cased mono label, figures
// set in Geist Mono, a hairline panel.
//
// The card leads with how many items the library holds. An earlier pass led
// with the byte total at 32pt, which makes storage the headline fact about a
// photo library; correcting that dropped the item total altogether, which was
// worse -- "21 photos, 0 videos, 1 album" does not add up to a library's size,
// and nothing else on the screen stated it. Total leads, bytes are a footnote,
// and the breakdown sits between them.
//
// Reachability is a word, not just a coloured dot. A dot alone cannot say
// whether green means "fresh" or merely "we drew something", and a screen
// reader gets nothing from it at all.
//
// It re-reads on every visit rather than once per mount. Mount-once meant the
// counts were only ever as fresh as the first time Settings had been opened
// this launch -- import a hundred photos and come back, and the card still
// reported the old total. The dot is the *last fetch's* outcome, not "we
// rendered, so the server must be up": a card showing month-old numbers under a
// green light is worse than one that admits it could not reach anything.
export default function LibraryStatsCard() {
  const tokens = useTokens();
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [host, setHost] = useState('');
  const [reachable, setReachable] = useState(true);

  const load = useCallback(async () => {
    try {
      const settings = await loadCaptureSettings();
      setHost(serverHost(settings.baseURL));
      setStats(await fetchStats(settings));
      setReachable(true);
    } catch {
      // Keep whatever numbers we already have -- they were true once, and
      // blanking the card on a dropped connection loses the only record of the
      // library's size the phone has. The dot is what says they are stale.
      setReachable(false);
    }
  }, []);

  // Deferred a tick, matching the pattern the other screens use so the first
  // setState does not fire synchronously inside the effect.
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => void load(), 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  if (!stats) return null;

  return (
    <View style={styles.wrap}>
      <ThemedView type="card" style={[styles.card, { borderColor: tokens.border }]}>
        <View style={styles.topRow}>
          {/* Not "LIBRARY": the settings list below this card already has a
              LIBRARY section (Free up space, Trash), and on device the two
              identical labels read as one heading repeated. This card is about
              what the server holds; that section is about acting on it. */}
          <ThemedText style={[styles.caps, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
            ON THE SERVER
          </ThemedText>

          <View style={styles.server}>
            <View style={[styles.dot, { backgroundColor: reachable ? tokens.ok : tokens.warn }]} />
            <ThemedText
              numberOfLines={1}
              style={[styles.status, { fontFamily: FontFamily.mono, color: tokens.mutedForeground }]}>
              {reachable ? 'Connected' : 'Last known'}
            </ThemedText>
          </View>
        </View>

        {/* The total, stated once and stated first. */}
        <View style={styles.totalRow}>
          <ThemedText style={[styles.total, { fontFamily: FontFamily.mono, color: tokens.foreground }]}>
            {formatCount(stats.total)}
          </ThemedText>
          <ThemedText type="small" themeColor="mutedForeground" style={styles.totalLabel}>
            {stats.total === 1 ? 'item' : 'items'}
          </ThemedText>
        </View>

        <View style={styles.counts}>
          <Stat label="Photos" value={stats.images} />
          <Stat label="Videos" value={stats.videos} />
          <Stat label="Albums" value={stats.albums} />
        </View>

        <ThemedText type="small" themeColor="mutedForeground" numberOfLines={1}>
          {[formatBytes(stats.total_bytes), `${formatCount(stats.trashed)} in trash`, host]
            .filter(Boolean)
            .join(' · ')}
        </ThemedText>
      </ThemedView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const tokens = useTokens();
  return (
    <View style={styles.stat}>
      <ThemedText style={[styles.statValue, { fontFamily: FontFamily.mono, color: tokens.foreground }]}>
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
  // A hairline border, not a shadow: Vault surfaces are drawn, not lifted.
  card: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  caps: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.4 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 11, lineHeight: 15, flexShrink: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  // The one figure that answers "how big is my library", so it is the biggest
  // thing on the card.
  total: { fontSize: 34, lineHeight: 40, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalLabel: { paddingBottom: 2 },
  counts: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 2 },
  // Tabular figures so the three columns line up and stay lined up as the
  // counts tick over.
  statValue: { fontSize: 20, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
