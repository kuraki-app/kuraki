import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import type { PlaceGroup } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
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
          <ThemedText type="subtitle" style={[heading, styles.header]}>
            {totalLocated} located {totalLocated === 1 ? 'photo' : 'photos'}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onPressPlace(item)}>
            <Image
              style={styles.cover}
              source={{
                uri: `${settings.baseURL}${item.cover_thumb_url}`,
                headers: { Authorization: `Bearer ${settings.deviceToken}` },
              }}
              contentFit="cover"
            />
            <View style={styles.meta}>
              <ThemedText style={heading}>{item.city}</ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                {item.country} · {item.count}
              </ThemedText>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 2, borderTopWidth: StyleSheet.hairlineWidth },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  cover: { width: 52, height: 52, borderRadius: 8 },
  meta: { flex: 1 },
});
