import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

type Props = {
  count: number;
  onRestore: () => void;
  onDeleteForever: () => void;
  onCancel: () => void;
};

// TrashSelectionBar is SelectionBar's Trash-screen counterpart (Task 8): same
// bottom-bar shell as the Task 7 SelectionBar, but with the two actions that
// make sense on trashed items — Restore and the destructive Delete forever —
// instead of Add to album / Move to trash. Kept as its own component because
// the action set is different enough that reusing SelectionBar would mean
// threading trash-specific props through a component every other grid uses.
export default function TrashSelectionBar({ count, onRestore, onDeleteForever, onCancel }: Props) {
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
        <Pressable onPress={onRestore} hitSlop={8} style={styles.action}>
          <ThemedText type="smallBold">Restore</ThemedText>
        </Pressable>
        <Pressable onPress={onDeleteForever} hitSlop={8} style={styles.action}>
          <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Delete forever</ThemedText>
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
