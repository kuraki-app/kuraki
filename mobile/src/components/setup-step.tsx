import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Spacing, useTokens } from '@/constants/theme';

/**
 * SetupStep is the frame every onboarding step sits in: a vertically centred
 * column with the app background.
 *
 * It scrolls. All four steps used to be a plain `View` with
 * `justifyContent: 'center'`, which is fine until the content is taller than
 * what is left of the screen -- the Pair step is a title, three paragraphs, a
 * code, a text field and two buttons, and with the keyboard up there was no way
 * to reach the bottom of it. `flexGrow: 1` on the content container keeps the
 * centring for short steps while letting tall ones scroll.
 */
export default function SetupStep({ children }: { children: ReactNode }) {
  const tokens = useTokens();

  return (
    <ScrollView
      style={{ backgroundColor: tokens.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    justifyContent: 'center',
  },
});
