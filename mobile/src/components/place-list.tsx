import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

// PlaceList is the draggable bottom sheet of places (city/country/count/cover).
// Cover thumbnails load through the authed URL — expo-image forwards the Bearer
// header the same way the rest of the app's grids do.
export default function PlaceList({ groups, settings, totalLocated, onPressPlace }: Props) {
  const tokens = useTokens();
  const snapPoints = useMemo(() => ['22%', '75%'], []);

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      backgroundStyle={{ backgroundColor: tokens.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.mutedForeground }}>
      <BottomSheetFlatList
        data={groups}
        keyExtractor={(g) => `${g.country}:${g.city}`}
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  cover: { width: 52, height: 52, borderRadius: 8 },
  meta: { flex: 1 },
});
