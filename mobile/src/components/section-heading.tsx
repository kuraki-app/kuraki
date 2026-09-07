import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { formatCount } from '@/lib/format';

/**
 * SectionHeading is the day/group divider above a run of tiles.
 *
 * It is the register split stated in one line: the label is Fraunces (Kura —
 * this is a photographic surface, and the date is prose) while the count beside
 * it is Geist Mono (Vault — a number is data). Previously both halves were the
 * same 14pt bold sans and there was no count at all, so a heading carried no
 * more information than the gap above it already did.
 *
 * The count is the point. Scrolling a library, the useful question at a date
 * boundary is "how much of this day is there" — a number answers it without
 * scrolling to find out.
 *
 * `onSelectAll` is offered only while selecting, and only when a caller passes
 * it: a select-all control sitting in every heading permanently would be an
 * invitation to a mode the user is not in.
 */
export type SectionHeadingProps = {
  title: string;
  /** How many assets sit under this heading. Hidden when zero or absent. */
  count?: number;
  /** Present only while a selection is active. */
  onSelectAll?: () => void;
  /** Which way the select-all control should go. */
  allSelected?: boolean;
};

export default function SectionHeading({ title, count, onSelectAll, allSelected = false }: SectionHeadingProps) {
  const tokens = useTokens();

  return (
    <View style={styles.row}>
      <ThemedText style={[styles.title, { fontFamily: FontFamily.heading, color: tokens.foreground }]}>
        {title}
      </ThemedText>

      {onSelectAll ? (
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${allSelected ? 'Deselect' : 'Select'} everything in ${title}`}
          onPress={onSelectAll}>
          <ThemedText type="smallBold" themeColor="stamp">
            {allSelected ? 'None' : 'Select all'}
          </ThemedText>
        </Pressable>
      ) : count ? (
        <ThemedText style={[styles.count, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
          {formatCount(count)}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  // 17/22 rather than a ThemedText type: `subtitle` is 20pt, which competes
  // with the screen title, and `smallBold` is the sans face this heading is
  // deliberately not in.
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  count: { fontSize: 13, lineHeight: 18 },
});
