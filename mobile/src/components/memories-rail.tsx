import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { memoryGroups, type MemoryGroup } from '@/lib/memories';
import { thumbSource, type LibraryAsset } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const CARD_WIDTH = 108;
const CARD_HEIGHT = 146;

/**
 * MemoriesRail is the row of "on this day" cards above the timeline.
 *
 * Memories were previously only reachable by switching the whole Library view
 * to a separate segment — which meant the feature was invisible unless you
 * already knew it existed and went looking. As a rail they resurface where the
 * user already is, and the segment stays as the "see all" surface behind them.
 *
 * Rendered as the timeline's `listHeader` rather than a sibling `View`, because
 * every Kuraki header is transparent: a sibling above the grid receives no
 * content inset and would sit under the status bar. Inside the list it inherits
 * the inset the tiles already get. See the `listHeader` note in photo-grid.tsx.
 *
 * Draws nothing at all when there are no memories. An empty state here would be
 * a permanent strip of nothing on most days of most libraries — the timeline
 * below it is the content, and the rail should not compete with it for a row of
 * screen it has no use for.
 */
export type MemoriesRailProps = {
  assets: LibraryAsset[];
  settings: CaptureSettings | null;
  /** Open the full memories view. */
  onPress?: (group: MemoryGroup) => void;
  /** Injected in tests; defaults to now. */
  now?: Date;
};

export default function MemoriesRail({ assets, settings, onPress, now }: MemoriesRailProps) {
  const groups = memoryGroups(assets, now);
  if (groups.length === 0 || !settings) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      // The rail scrolls sideways inside a list that scrolls down; without this
      // a mostly-vertical drag starting on a card is claimed by the rail and the
      // timeline stops following the finger.
      directionalLockEnabled>
      {groups.map((group) => (
        <MemoryCard key={group.key} group={group} settings={settings} onPress={onPress} />
      ))}
    </ScrollView>
  );
}

function MemoryCard({
  group,
  settings,
  onPress,
}: {
  group: MemoryGroup;
  settings: CaptureSettings;
  onPress?: (group: MemoryGroup) => void;
}) {
  const tokens = useTokens();
  const source = thumbSource(settings, group.cover);

  return (
    <Pressable
      accessibilityRole="button"
      // No count in the label. `count` is how many of that year have *loaded*,
      // and the memories feed is paginated, so speaking it aloud would assert a
      // total the rail does not know.
      accessibilityLabel={`${group.title}, ${group.subtitle}`}
      onPress={() => onPress?.(group)}
      style={[styles.card, { backgroundColor: tokens.thumb }]}>
      {source ? <Image source={source} style={styles.cover} contentFit="cover" transition={160} cachePolicy="disk" /> : null}

      {/* The caption sits on the photograph, so it carries its own darkness
          rather than trusting whatever happens to be in the frame. */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
        locations={[0, 1]}
        style={styles.scrim}
        pointerEvents="none"
      />

      <View style={styles.caption} pointerEvents="none">
        <ThemedText style={styles.title} numberOfLines={1}>
          {group.title}
        </ThemedText>
        <ThemedText style={styles.subtitle} numberOfLines={1}>
          {group.subtitle}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.one },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  caption: { paddingHorizontal: 10, paddingBottom: 10, gap: 1 },
  // Fixed white, not a token: this is over a photograph, not over the app's
  // background, in both themes.
  title: { color: '#ffffff', fontSize: 13, lineHeight: 17, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 11, lineHeight: 15 },
});
