import { Platform } from 'react-native';
import { FontFamily } from '@/design/fonts';

// The web keys two registers off <main data-register>. Mobile maps them per tab:
// Library=kura (8px rhythm), Backup/Settings=vault (4px rhythm). The register
// belongs to the page frame — the photo grid and viewer always render kura
// regardless.
//
// The split used to change typeface too — Fraunces for Kura headings, Geist
// Mono for Vault data. It no longer does: the app is one system sans, and the
// registers govern rhythm, density and layout only. `heading`/`mono` stay in
// the returned shape so call sites do not all have to change, and so the seam
// is still named where a future register could act on it.
export type Register = 'kura' | 'vault';

const systemSans = Platform.select({ ios: 'system-ui', android: 'normal', default: 'normal' })!;

export function registerStyle(register: Register) {
  return register === 'kura'
    ? { unit: 8, heading: FontFamily.heading, mono: FontFamily.mono, body: systemSans }
    : { unit: 4, heading: FontFamily.monoBold, mono: FontFamily.mono, body: systemSans };
}
