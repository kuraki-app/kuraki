import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle, type Register } from '@/design/registers';

type Action = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  /** Which type register the title takes. Photo surfaces are `kura`, manage
   *  surfaces `vault` — the same split the pages themselves follow. */
  register?: Register;
  /** Optional confirm in the header, opposite Close (the tag editor's "Done"). */
  action?: Action;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Dialog is the app's one modal surface: a centred card over a dimmed backdrop.
 *
 * It replaces `@gorhom/bottom-sheet`, which every pick-one-thing surface here
 * used to be. The sheets rendered *inline* in the screen's view tree, so they
 * were laid out inside the screen and the native `UITabBar` that `NativeTabs`
 * draws sat on top of their bottom edge. In "Add to album" that swallowed the
 * album list's last rows and the Create button — visible-looking UI that could
 * not be tapped. Every sheet in the app had the same flaw; the pickers just made
 * it obvious because their controls live at the bottom.
 *
 * A `Modal` is not laid out inside the screen at all: the platform gives it its
 * own window above everything the app has drawn, tab bar included. That is the
 * property being bought here, not the look — no amount of padding fixes an
 * inline sheet, because the tab bar is not part of the layout it can pad away
 * from.
 *
 * Dismissal is the backdrop, the Close button, and Android's back button
 * (`onRequestClose`) — three exits, where a sheet offered a downward drag that
 * no longer had anywhere to go.
 */
export default function Dialog({
  visible,
  title,
  register = 'vault',
  action,
  onClose,
  children,
}: Props) {
  const tokens = useTokens();
  const reg = registerStyle(register);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      {/* The backdrop is the outer pressable and the card sits inside it, so a
          tap that lands on the card must not close: `onStartShouldSetResponder`
          claims the touch before it reaches the parent. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centre}>
          <View
            onStartShouldSetResponder={() => true}
            style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={[styles.header, { borderBottomColor: tokens.border }]}>
              <ThemedText type="subtitle" style={[{ fontFamily: reg.heading }, styles.title]} numberOfLines={2}>
                {title}
              </ThemedText>
              {action ? (
                <Pressable onPress={action.onPress} disabled={action.disabled} hitSlop={8}>
                  <ThemedText
                    type="smallBold"
                    themeColor="primary"
                    style={action.disabled ? styles.disabled : undefined}>
                    {action.label}
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <ThemedText type="smallBold" themeColor="mutedForeground">✕</ThemedText>
              </Pressable>
            </View>
            {/* shrink, not grow: a two-row list makes a short dialog, and a long
                one stops at maxHeight and scrolls inside whatever the caller
                put here. */}
            <View style={styles.body}>{children}</View>
          </View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  card: {
    width: '100%',
    // Wide enough for a phone, capped so the card does not stretch edge to edge
    // on a tablet.
    maxWidth: 520,
    maxHeight: '85%',
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1 },
  disabled: { opacity: 0.5 },
  body: { flexShrink: 1 },
});
