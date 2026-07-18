/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useTokens } from '@/constants/theme';

export function useTheme() {
  return useTokens();
}
