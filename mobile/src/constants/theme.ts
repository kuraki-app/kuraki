/**
 * Theme tokens for the app. Colors come from the generated Kuraki design
 * tokens (`@/design/tokens.ts`, synced from `web/src/app.css`) rather than a
 * hand-rolled palette, so mobile and web always render the same brand.
 */

import { darkTokens, lightTokens, type TokenName } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemeTokens = Record<TokenName, string>;

export function useTokens(): ThemeTokens {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTokens : lightTokens;
}

/**
 * The spacing rhythm, in points.
 *
 * Rebased onto a 4pt grid with a real 12 between 8 and 20. The old scale ran
 * 2/4/8/16/24/32 — doubling from 8 straight to 16 — so every time 8 was too
 * tight and 16 too loose, 8 won. A census of the app found `two` (8) carrying
 * almost all of the vertical work: 18 paddingVertical, 20 gap, 14
 * paddingHorizontal. That single missing step is why the whole app read as
 * compact, and adding it loosens every one of those sites at once rather than
 * through eighty individual edits.
 *
 * The names are positions in the scale, not multiples of anything, which is why
 * renumbering them here is safe: no caller does arithmetic on them.
 */
export const Spacing = {
  half: 4,
  one: 8,
  two: 12,
  three: 20,
  four: 28,
  five: 40,
  six: 64,
} as const;

/**
 * Corner radii, in points.
 *
 * Split out of `Spacing`, which was quietly doing both jobs — 30 border radii
 * were written as `Spacing.two`. That coupling meant the scale could not be
 * loosened without rounding every corner in the app as a side effect, so a
 * spacing decision and a shape decision could not be made independently. They
 * are separate now, and these values are exactly what those radii already were.
 */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

// There is deliberately no BottomTabInset here any more. It was a hardcoded
// 50pt on iOS / 80 on Android, used to lift a floating selection bar clear of
// the tab bar — but that bar is a real UITabBar drawn by NativeTabs, whose
// height is the system's, varies with the home indicator, and changes again
// when `minimizeBehavior` collapses it. The guess was wrong on device and hid
// the bar's actions. Nothing floats over the tab bar now; selection lives in
// the native header (see selection-toolbar.tsx). If something ever must, ask
// the platform (`useSafeAreaInsets`), do not guess again.
export const MaxContentWidth = 800;
