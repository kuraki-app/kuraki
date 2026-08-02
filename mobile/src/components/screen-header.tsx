import { Stack } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTokens } from '@/constants/theme';
import { registerStyle, type Register } from '@/design/registers';

type ScreenOptions = NonNullable<ComponentProps<typeof Stack.Screen>['options']>;

export type ScreenHeaderProps = {
  /** The title the header shows. Also the back label of anything pushed on top. */
  title: string;
  /**
   * Which type register the title takes: `kura` (Fraunces) for the photo
   * surfaces, `vault` (Geist Mono) for the manage/settings surfaces. Matches
   * the mapping in `@/design/registers`.
   */
  register?: Register;
  /**
   * iOS large title. **Off by default, and only safe to switch on when the
   * screen's scroll view is its direct child.**
   *
   * A large title makes UIKit overlay the navigation bar and rely on the
   * screen's first-descendant scroll view to carry the content inset. When
   * react-native-screens cannot find one -- because the scroll view is nested
   * behind a wrapper view, a conditional banner or an error state -- nothing
   * applies the inset and the title draws straight over the content. That is
   * precisely the bug this header replaced on the Settings screen.
   *
   * So: the settings pages opt in (their ScrollView is the screen's root); the
   * photo surfaces do not (their grid sits behind banners and wrappers) and
   * take the compact title, which needs no inset cooperation at all.
   */
  large?: boolean;
  /** Right-hand accessory — a menu, an add button. */
  right?: () => ReactNode;
};

/**
 * headerOptions is the one definition of what a Kuraki header looks like.
 *
 * Every screen used to draw its own bar out of a `View` with `paddingTop:
 * insets.top`, a hand-placed title and a hand-rolled back affordance -- seven
 * of them, in three different type sizes, with three different back
 * treatments. None of them collapsed on scroll, none of them blurred, and each
 * one had to re-derive the notch inset itself.
 *
 * This returns navigation options instead of rendering anything, because the
 * header worth having is the platform's own: `headerLargeTitle` gives the
 * collapse-on-scroll behaviour and the blur, and the stack gives the system
 * back button and the interactive back gesture. Colours are absent on purpose
 * -- the navigation theme in `app/_layout.tsx` is built from the Kuraki tokens,
 * so the header already carries the right palette.
 */
export function headerOptions({
  title,
  register = 'kura',
  large = false,
  right,
}: ScreenHeaderProps): ScreenOptions {
  const reg = registerStyle(register);

  return {
    title,
    headerLargeTitle: large,
    headerLargeTitleStyle: { fontFamily: reg.heading },
    headerTitleStyle: { fontFamily: reg.heading },
    // The hairline under a large title reads as a seam against the app's flat
    // paper background, and it is the one part of the native header that does
    // not match anything else in the palette.
    headerLargeTitleShadowVisible: false,
    // Show the chevron alone rather than the previous screen's title: these
    // titles ("Duplicates", "Notifications") are long enough to crowd out a
    // pushed screen's own title on a phone.
    headerBackButtonDisplayMode: 'minimal',
    headerRight: right,
  };
}

/**
 * ScreenHeader declares a screen's header from inside the screen itself, which
 * is what the screens that own state the header needs (a selection count, a
 * live filter) require. A screen with a static title can equally well be
 * configured from its layout with `headerOptions` directly.
 */
export default function ScreenHeader(props: ScreenHeaderProps) {
  return <Stack.Screen options={headerOptions(props)} />;
}

/**
 * HeaderButton is an icon action sized for the navigation bar — the shape a
 * `headerRight` wants. It carries a glyph fallback because SF Symbols do not
 * exist on Android, where `SymbolView` renders nothing at all rather than
 * degrading.
 */
export function HeaderButton({
  symbol,
  glyph,
  label,
  onPress,
}: {
  symbol: SFSymbol;
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={12}
      style={styles.button}>
      <SymbolView
        name={symbol}
        size={20}
        tintColor={tokens.foreground}
        fallback={<ThemedText type="smallBold">{glyph}</ThemedText>}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 32, alignItems: 'flex-end', justifyContent: 'center' },
});
