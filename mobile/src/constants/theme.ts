/**
 * Theme tokens for the app. Colors come from the generated Kuraki design
 * tokens (`@/design/tokens.ts`, synced from `web/src/app.css`) rather than a
 * hand-rolled palette, so mobile and web always render the same brand.
 */

import { darkTokens, designMetrics, lightTokens, type TokenName } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemeTokens = Record<TokenName, string>;

export function useTokens(): ThemeTokens {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTokens : lightTokens;
}

// All native spacing comes from the same generated scale as web.
export const Space = designMetrics.spacing;
export const TypeScale = designMetrics.type;
export const Layout = designMetrics.layout;

/** Shared interaction values. CSS consumes these tokens directly; native
 * converts the same source strings into numbers for Animated. */
export const Motion = {
  instant: Number.parseFloat(lightTokens.tInstant),
  crisp: Number.parseFloat(lightTokens.tCrisp),
  settle: Number.parseFloat(lightTokens.tSettle),
  pressScale: Number.parseFloat(lightTokens.pressScale),
} as const;

/**
 * Corner radii, in points.
 *
 * Split out of `Space`, which was quietly doing both jobs — 30 border radii
 * were written as `Space.two`. That coupling meant the scale could not be
 * loosened without rounding every corner in the app as a side effect, so a
 * spacing decision and a shape decision could not be made independently. They
 * are separate now, and these values are exactly what those radii already were.
 */
export const Radius = {
  ...designMetrics.radius,
} as const;

// There is deliberately no BottomTabInset here any more. It was a hardcoded
// 50pt on iOS / 80 on Android, used to lift a floating selection bar clear of
// the tab bar — but that bar is a real UITabBar drawn by NativeTabs, whose
// height is the system's, varies with the home indicator, and changes again
// when `minimizeBehavior` collapses it. The guess was wrong on device and hid
// the bar's actions. Nothing floats over the tab bar now; selection lives in
// the native header (see selection-toolbar.tsx). If something ever must, ask
// the platform (`useSafeAreaInsets`), do not guess again.
export const MaxContentWidth = designMetrics.layout.readableMax;
