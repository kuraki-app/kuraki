import { Platform } from 'react-native';

/**
 * One family, everywhere: the platform's own sans.
 *
 * Kuraki previously bundled Fraunces for display headings and Geist Mono for
 * data columns, and the Kura/Vault registers switched between them. The
 * registers remain — they still govern rhythm, density and layout — but they no
 * longer change typeface. Hierarchy is carried by size and weight instead,
 * which is what a photo app wants: the type should seat the photographs, not
 * compete with them.
 *
 * Using the system face also removes a startup gate. Bundled fonts have to load
 * before the first frame can be trusted, so the app held a splash until
 * `useFonts` resolved; the platform sans is already resident and there is
 * nothing to wait for.
 *
 * `system-ui` resolves to SF on iOS. React Native on Android does not map it,
 * where the empty/`normal` family is already Roboto — hence the platform split
 * rather than one string.
 */
const systemSans = Platform.select({ ios: 'system-ui', android: 'normal', default: 'normal' })!;

export const FontFamily = {
  heading: systemSans,
  mono: systemSans,
  monoBold: systemSans,
} as const;
