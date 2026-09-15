import { Image } from 'expo-image';
import { FlatList, StyleSheet, View } from 'react-native';

import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import MotionPressable from '@/components/motion-pressable';
import { Space, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { registerStyle } from '@/design/registers';
import { formatCount } from '@/lib/format';
import type { PlaceGroup } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  groups: PlaceGroup[];
  settings: CaptureSettings;
  totalLocated: number;
  onPressPlace: (group: PlaceGroup) => void;
};

/**
 * PlaceList is the list of places (city/country/count/cover) below the map.
 *
 * It is a panel in the Places layout, not a floating sheet over the map. As a
 * `@gorhom/bottom-sheet` it was laid out inside the screen, so the tab bar
 * covered its lower rows — and unlike the app's other sheets this one had no
 * dismiss at all, being the screen's own content, so there was no way to get
 * the hidden places back. A panel in normal flow cannot be overlapped.
 *
 * The other sheets became dialogs (see dialog.tsx); this one did not, because a
 * screen's primary content behind a modal would be a worse answer than the bug.
 *
 * Cover thumbnails load through the authed URL — expo-image forwards the Bearer
 * header the same way the rest of the app's grids do.
 */
export default function PlaceList({ groups, settings, totalLocated, onPressPlace }: Props) {
  const tokens = useTokens();

  return (
    <View style={[styles.panel, { backgroundColor: tokens.card, borderTopColor: tokens.border }]}>
      <FlatList
        data={groups}
        keyExtractor={(g) => `${g.country}:${g.city}`}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText style={[heading, styles.headerTitle]}>
              {formatCount(groups.length)} {groups.length === 1 ? 'place' : 'places'}
            </ThemedText>
            <ThemedText type="small" themeColor="textFaint">
              {formatCount(totalLocated)} located {totalLocated === 1 ? 'photo' : 'photos'}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <MotionPressable style={styles.row} pressedScale={0.985} onPress={() => onPressPlace(item)}>
            <Image
              style={styles.cover}
              source={{
                uri: `${settings.baseURL}${item.cover_thumb_url}`,
                headers: { Authorization: `Bearer ${settings.deviceToken}` },
              }}
              contentFit="cover"
            />
            <View style={styles.meta}>
              <ThemedText style={styles.city} numberOfLines={1}>
                {item.city}
              </ThemedText>
              <ThemedText type="small" themeColor="textFaint" numberOfLines={1}>
                {item.country}
              </ThemedText>
            </View>
            {/* The count is data, so it is mono and right-aligned into its own
                column — read down the list it answers "where are most of my
                photos" at a glance, which it could not do buried after the
                country in the same sentence. */}
            <ThemedText style={[styles.count, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
              {formatCount(item.count)}
            </ThemedText>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={tokens.textFaint}
              fallback={<ThemedText themeColor="textFaint">›</ThemedText>}
            />
          </MotionPressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 2, borderTopWidth: StyleSheet.hairlineWidth },
  header: { paddingHorizontal: Space.four, paddingTop: Space.two, paddingBottom: Space.one, gap: 2 },
  headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  city: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  count: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.two,
    paddingHorizontal: Space.four,
    paddingVertical: Space.one,
  },
  cover: { width: 52, height: 52, borderRadius: 8 },
  meta: { flex: 1 },
});
