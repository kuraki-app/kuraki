import { Platform } from 'react-native';
import { FontFamily } from '@/design/fonts';

// The web keys two registers off <main data-register>. Mobile maps them per tab:
// Library=kura (Fraunces, 8px rhythm, warm paper), Backup/Settings=vault
// (Geist Mono, 4px rhythm, flat data). The register belongs to the page frame —
// the photo grid and viewer always render kura regardless.
export type Register = 'kura' | 'vault';

const systemSans = Platform.select({ ios: 'system-ui', android: 'normal', default: 'normal' })!;

export function registerStyle(register: Register) {
  return register === 'kura'
    ? { unit: 8, heading: FontFamily.heading, mono: FontFamily.mono, body: systemSans }
    : { unit: 4, heading: FontFamily.monoBold, mono: FontFamily.mono, body: systemSans };
}
