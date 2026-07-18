import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  count: number;
  onAddToAlbum: () => void;
  onTrash: () => void;
  onCancel: () => void;
};

// SelectionBar is the bottom action bar shown while a photo grid is in
// selection mode (Task 7): cancel + count on the left, the two bulk actions
// on the right. It floats above the native tab bar (BottomTabInset) so it
// never gets hidden behind it.
export default function SelectionBar({ count, onAddToAlbum, onTrash, onCancel }: Props) {
  const tokens = useTokens();

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: tokens.card, borderTopColor: tokens.border, paddingBottom: Spacing.two + BottomTabInset },
      ]}>
      <View style={styles.left}>
        <Pressable onPress={onCancel} hitSlop={8} style={styles.cancel}>
          <ThemedText type="smallBold">✕</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={heading}>{count} selected</ThemedText>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onAddToAlbum} hitSlop={8} style={styles.action}>
          <ThemedText type="smallBold">Add to album</ThemedText>
        </Pressable>
        <Pressable onPress={onTrash} hitSlop={8} style={styles.action}>
          <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Move to trash</ThemedText>
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  action: { paddingVertical: Spacing.one },
});
