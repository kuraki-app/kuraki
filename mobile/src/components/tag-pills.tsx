import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import type { Tag } from '@/lib/library-api';

/** How many tags the row shows before deferring to the full browser. */
const VISIBLE = 8;

/**
 * TagPills is the row of tags under the search filters.
 *
 * Search previously offered a "Browse tags" text link, which is a correct
 * affordance and a poor one: it tells you tags exist without telling you what
 * any of them are, so finding a tag cost a sheet, a scroll and a dismissal even
 * when the tag you wanted was one of four. The pills put the common case one
 * tap away and keep the sheet for the rest.
 *
 * Horizontally scrolling rather than wrapping: a library with thirty tags would
 * otherwise push the results themselves off the screen, and the results are
 * what the user came for.
 *
 * **The browse control renders even when the row has no tags to show.** Hiding
 * the whole row on an empty list took the tag browser with it, so a library
 * whose tags had not loaded yet — or a device that was offline — had no way to
 * reach tags at all. That is a worse failure than an almost-empty row, because
 * it is indistinguishable from the feature not existing. The label says
 * "Browse tags" when it stands alone and shortens to "More" once there are
 * pills in front of it.
 */
export type TagPillsProps = {
  tags: Tag[];
  onPickTag: (tag: Tag) => void;
  onBrowseAll: () => void;
};

export default function TagPills({ tags, onPickTag, onBrowseAll }: TagPillsProps) {
  const tokens = useTokens();
  const shown = tags.slice(0, VISIBLE);

  return (
    <View style={styles.wrap}>
      <ThemedText style={[styles.caps, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>TAGS</ThemedText>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {shown.map((tag) => (
          <Pressable
            key={tag.id}
            accessibilityRole="button"
            accessibilityLabel={`Search the tag ${tag.name}`}
            onPress={() => onPickTag(tag)}
            style={[styles.pill, { backgroundColor: tokens.secondary }]}>
            <ThemedText style={[styles.pillText, { color: tokens.textDim }]}>{tag.name}</ThemedText>
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Browse all tags"
          onPress={onBrowseAll}
          style={[styles.pill, styles.pillOutline, { borderColor: tokens.border }]}>
          <ThemedText style={[styles.pillText, { color: tokens.textFaint }]}>
            {shown.length ? 'More' : 'Browse tags'}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.half },
  caps: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.4 },
  row: { gap: Space.one, paddingRight: Space.four },
  pill: { height: 32, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 16 },
  pillOutline: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 13, lineHeight: 17 },
});
