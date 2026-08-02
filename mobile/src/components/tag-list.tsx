import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import Dialog from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { fetchTags, type Tag } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// TagList is the browse dialog opened from the Library header. Flat,
// name-ordered (hierarchy deferred); tapping a tag hands it back for navigation
// to its grid.
export default function TagList({
  settings,
  onPressTag,
  onClose,
}: {
  settings: CaptureSettings;
  onPressTag: (tag: Tag) => void;
  onClose: () => void;
}) {
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
    <Dialog visible title="Tags" onClose={onClose}>
      <FlatList
        data={tags}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onPressTag(item)}>
            <ThemedText style={heading}>{item.name}</ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="mutedForeground" style={styles.row}>No tags yet.</ThemedText>
        }
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  // Keeps the first row off the header's divider and the last off the card's
  // rounded corner; the list still scrolls edge to edge behind it.
  list: { paddingVertical: Spacing.one },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
