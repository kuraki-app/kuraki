import { useFonts, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { GeistMono_400Regular, GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono';

// Only the weights actually used are bundled — Fraunces display for Kura headings,
// Geist Mono for Vault data columns. Body text uses the platform sans.
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    Fraunces_600SemiBold,
    GeistMono_400Regular,
    GeistMono_600SemiBold,
  });
  return loaded;
}

export const FontFamily = {
  heading: 'Fraunces_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoBold: 'GeistMono_600SemiBold',
} as const;
