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

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
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
