import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  count: number;
  /** How many are selectable in total, so Select all can flip to Select none
   *  once everything is already chosen. */
  total?: number;
  onAddToAlbum: () => void;
  onTrash: () => void;
  onCancel: () => void;
  onSelectAll?: () => void;
  /** Only inside an album: unlink the selection from *this* album. A different
   *  act from moving it to trash, and deliberately labelled so. */
  onRemoveFromAlbum?: () => void;
};

// SelectionBar is the bottom action bar shown while a photo grid is in
// selection mode: cancel + count on the left, the bulk actions on the right.
// It floats above the native tab bar (BottomTabInset) so it never gets hidden
// behind it.
export default function SelectionBar({
  count,
  total,
  onAddToAlbum,
  onTrash,
  onCancel,
  onSelectAll,
  onRemoveFromAlbum,
}: Props) {
  const tokens = useTokens();
  const allChosen = total != null && total > 0 && count >= total;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: tokens.card, borderTopColor: tokens.border, paddingBottom: Spacing.two + BottomTabInset },
      ]}>
      <View style={styles.left}>
        <Pressable onPress={onCancel} hitSlop={8} style={styles.cancel} accessibilityRole="button">
          <ThemedText type="smallBold">✕</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={heading}>{count} selected</ThemedText>
      </View>
      <View style={styles.actions}>
        {onSelectAll ? (
          <Pressable onPress={onSelectAll} hitSlop={8} style={styles.action} accessibilityRole="button">
            <ThemedText type="smallBold">{allChosen ? 'None' : 'All'}</ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onAddToAlbum} hitSlop={8} style={styles.action} accessibilityRole="button">
          <ThemedText type="smallBold">Album</ThemedText>
        </Pressable>
        {onRemoveFromAlbum ? (
          <Pressable
            onPress={onRemoveFromAlbum}
            hitSlop={8}
            style={styles.action}
            accessibilityRole="button">
            <ThemedText type="smallBold">Remove</ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onTrash} hitSlop={8} style={styles.action} accessibilityRole="button">
          <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Trash</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cancel: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Labels are single words ("Album", "Remove", "Trash") rather than the old
  // "Add to album" / "Move to trash": with up to four actions plus the count,
  // the longer wording wrapped on a narrow phone.
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  action: { paddingVertical: Spacing.one },
});
