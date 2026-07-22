import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { fetchTags, type Tag } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// TagList is the browse sheet opened from the Library header. Flat, name-ordered
// (hierarchy deferred); tapping a tag hands it back for navigation to its grid.
export default function TagList({
  settings,
  onPressTag,
  onClose,
}: {
  settings: CaptureSettings;
  onPressTag: (tag: Tag) => void;
  onClose: () => void;
}) {
  const tokens = useTokens();
  const snapPoints = useMemo(() => ['40%', '80%'], []);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTags(settings)
      .then((t) => {
        if (!cancelled) setTags(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings]);

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: tokens.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.mutedForeground }}>
      <ThemedText type="subtitle" style={[heading, styles.header]}>Tags</ThemedText>
      <BottomSheetFlatList
        data={tags}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onPressTag(item)}>
            <ThemedText style={heading}>{item.name}</ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="mutedForeground" style={styles.row}>No tags yet.</ThemedText>
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.one },
  row: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
});
