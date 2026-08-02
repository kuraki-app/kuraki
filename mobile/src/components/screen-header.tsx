import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useTokens } from '@/constants/theme';
import { registerStyle, type Register } from '@/design/registers';

type ScreenOptions = NonNullable<ComponentProps<typeof Stack.Screen>['options']>;

/**
 * withAlpha adds an alpha channel to a `#RRGGBB` token.
 *
 * `--background` is a plain six-digit hex in both themes (the palette is
 * generated into `design/tokens.ts` from `web/src/app.css`), and RN understands
 * `#RRGGBBAA`. Anything else — an `rgba()` token, a shorthand — cannot take a
 * suffix, so it is returned untouched: a scrim that fails to fade is survivable,
 * an invalid colour string is not.
 */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

/**
 * HeaderScrim is the header's background: the app's own paper colour at the top
 * of the screen, dissolving to fully transparent by the bottom of the bar.
 *
 * The header is transparent, so content runs edge to edge underneath it and the
 * title floats over the top of the page. Without a scrim that is unreadable the
 * moment a photograph or a card scrolls behind the title; with one, whatever
 * passes underneath fades into the background as it reaches the title instead
 * of colliding with it.
 *
 * Colours come from the tokens, so the fade is the page's own background in
 * both themes rather than a hardcoded white or black.
 */
function HeaderScrim() {
  // Read here rather than passed in: `headerBackground` is rendered by the
  // navigator, so this is a real component position and can hold hooks — which
  // keeps `headerOptions` a plain function that any layout can call.
  const tokens = useTokens();
  const base = tokens.background;
  return (
    <LinearGradient
      // Solid for the top half — the status bar and the title itself need a
      // dependable backdrop — then a fast falloff so the transition reads as a
      // fade rather than a band with an edge.
      colors={[withAlpha(base, 'ff'), withAlpha(base, 'f2'), withAlpha(base, '00')]}
      locations={[0, 0.55, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}

export type ScreenHeaderProps = {
  /** The title the header shows. Also the back label of anything pushed on top. */
  title: string;
  /**
   * Which type register the title takes. Defaults to `vault` (Geist Mono),
   * which is every header in the app — see the note on `headerOptions`. The
   * parameter stays because the register split still governs *content*, and a
   * screen may one day want its header to follow.
   */
  register?: Register;
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
 * This returns navigation options rather than rendering anything, because the
 * header worth having is the platform's own: the stack gives the system back
 * button and the interactive back gesture. Colours are absent on purpose -- the
 * navigation theme in `app/_layout.tsx` is built from the Kuraki tokens, so the
 * header already carries the right palette.
 *
 * **There is deliberately no `headerLargeTitle` here.** A large title makes
 * UIKit overlay the navigation bar and rely on the screen's first-descendant
 * scroll view to carry the content inset; on device it underlapped the content
 * even with the ScrollView as the screen's direct child and
 * `contentInsetAdjustmentBehavior="automatic"` set, drawing "Settings" over the
 * library stats card. The compact header positions content correctly on every
 * screen because it does not depend on finding a scroll view at all. If a large
 * title is ever wanted again, it needs verifying on hardware first -- the
 * inset is the whole feature, and it did not work here.
 */
export function headerOptions({ title, register = 'vault' }: ScreenHeaderProps): ScreenOptions {
  const reg = registerStyle(register);

  return {
    title,
    headerTitleStyle: { fontFamily: reg.heading },
    // The header floats over the page rather than sitting above it: content
    // runs from the very top of the screen and passes underneath the title,
    // fading into the background as it goes (see HeaderScrim).
    //
    // This also hands the top inset back to the platform. React Navigation
    // renders content under a transparent header by design, while a scroll
    // view's `contentInsetAdjustmentBehavior="automatic"` still accounts for
    // the status bar and the tab bar — so no screen needs to compute an inset,
    // and the bottom inset that the native tab bar owns is untouched.
    headerTransparent: true,
    headerBackground: () => <HeaderScrim />,
    // A hairline under a header that is meant to dissolve would draw the exact
    // edge the gradient exists to remove.
    headerShadowVisible: false,
    // Show the chevron alone rather than the previous screen's title: these
    // titles ("Duplicates", "Notifications") are long enough to crowd out a
    // pushed screen's own title on a phone.
    headerBackButtonDisplayMode: 'minimal',
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
 * toolbarGlyph returns the props that put a mark on a `Stack.Toolbar` item.
 *
 * On iOS that is the SF Symbol. On Android it is a short text label, because
 * expo-router's own types are explicit that Android renders only image sources
 * there -- "SF Symbols and xcasset icons are silently dropped" -- so a symbol
 * name produces a control with nothing in it. Silently, which is why a clean
 * bundle says nothing about it.
 *
 * Chosen over passing both and letting the label show through: the docs say an
 * icon suppresses the label and leaves it to accessibility only, so relying on
 * a fallback would depend on behaviour that cannot be checked from here.
 * Branching on the platform is at least honest about what each one gets.
 */
export function toolbarGlyph(symbol: SFSymbol, label: string) {
  return Platform.OS === 'android' ? { label } : { icon: symbol };
}

/*
 * There is deliberately no header-action helper here.
 *
 * A header action is a `Stack.Toolbar` item, declared by the screen that owns
 * it (see gallery-menu.tsx and the Albums screen). Routing one through
 * `headerRight` instead renders it as an arbitrary custom view, which iOS 26
 * wraps in its shared glass background — the large white disc that used to
 * float in the Gallery's corner.
 */
