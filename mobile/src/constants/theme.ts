/**
 * Theme tokens for the app. Colors come from the generated Kuraki design
 * tokens (`@/design/tokens.ts`, synced from `web/src/app.css`) rather than a
 * hand-rolled palette, so mobile and web always render the same brand.
 */

import { Platform } from 'react-native';

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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
