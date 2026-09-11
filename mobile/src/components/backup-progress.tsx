import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import MotionProgress from '@/components/motion-progress';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { backupProgress } from '@/lib/backup-indicator';
import type { BackupProgress } from '@/lib/backup-engine';
import { formatCount } from '@/lib/format';

/**
 * BackupProgressCard is what a run in flight looks like.
 *
 * Progress was a sentence — "IMG_4471.mov · 38%" — in the same muted footnote
 * style as every other note on the page, which is the one thing on this screen
 * that changes second to second and it looked like static help text. A card
 * with a bar says three things a sentence cannot: how far through the run is,
 * how much there is in total, and that something is happening at all.
 *
 * Renders nothing when no run is in flight. A permanently-present empty
 * progress card would be a bar at zero, which reads as "stuck" rather than
 * "idle".
 */
export function BackupProgressCard({ progress }: { progress: BackupProgress | null }) {
  const tokens = useTokens();
  if (!progress?.running) return null;

  const { total, fraction } = backupProgress(progress.done, progress.pending);

  return (
    <View style={styles.wrap}>
      <ThemedView type="card" style={[styles.card, { borderColor: tokens.border }]}>
        <View style={styles.headRow}>
          <ThemedText style={styles.heading}>Backing up</ThemedText>
          {total > 0 ? (
            <ThemedText style={[styles.count, { fontFamily: FontFamily.mono, color: tokens.mutedForeground }]}>
              {formatCount(progress.done)} / {formatCount(total)}
            </ThemedText>
          ) : null}
        </View>

        {/* Determinate whenever there is a total to be a fraction of. A run
            that has not finished scanning yet has none, so the track shows
            empty rather than asserting a position it cannot know. */}
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          style={[styles.track, { backgroundColor: tokens.secondary }]}>
          <MotionProgress fraction={fraction} color={tokens.highlight} />
        </View>

        {progress.currentFile ? (
          <ThemedText type="small" themeColor="textFaint" numberOfLines={1}>
            {progress.currentFile}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textFaint">
          Resumes where it stopped — mid-file, not mid-queue.
        </ThemedText>
      </ThemedView>
    </View>
  );
}

/**
 * BackupFailures lists the items a run could not upload.
 *
 * These were tracked by the engine and rendered nowhere: `progress.failed` had
 * no reader on this screen, so a photo that failed for a reason the user could
 * act on — the file is no longer on the device, the type is not media — simply
 * never appeared, and the backup looked complete. Naming the file and the
 * reason is the difference between a silent gap in a library and a decision
 * someone can make.
 *
 * The closing line matters as much as the list: without it, a failure reads as
 * something the user must now go and fix by hand.
 */
export function BackupFailures({ failed }: { failed: BackupProgress['failed'] }) {
  const tokens = useTokens();
  if (failed.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <ThemedText style={[styles.caps, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
        NEEDS ATTENTION
      </ThemedText>

      <View style={styles.failedList}>
        {failed.map((item) => (
          <View key={item.localId} style={[styles.failedRow, { backgroundColor: tokens.secondary }]}>
            <SymbolView
              name="exclamationmark.triangle"
              size={20}
              tintColor={tokens.warn}
              fallback={<ThemedText style={{ color: tokens.warn }}>!</ThemedText>}
            />
            <View style={styles.failedText}>
              <ThemedText type="small" numberOfLines={1}>
                {item.filename}
              </ThemedText>
              <ThemedText type="small" themeColor="textFaint" numberOfLines={2}>
                {item.error}
              </ThemedText>
            </View>
          </View>
        ))}
      </View>

      <ThemedText type="small" themeColor="textFaint">
        Retried automatically on the next run.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one },
  card: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  count: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  caps: { paddingHorizontal: Spacing.one, fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.4 },
  failedList: { gap: Spacing.one },
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.two,
  },
  failedText: { flex: 1, gap: 1 },
});
