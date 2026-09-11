import { FontFamily } from '@/design/fonts';

// The web keys two registers off <main data-register>. Mobile maps them per tab:
// Library=kura (8px rhythm), Backup/Settings=vault (4px rhythm). The register
// belongs to the page frame — the photo grid and viewer always render kura
// regardless.
//
// Typography stays consistent across registers; only rhythm and density vary.
export type Register = 'kura' | 'vault';

export function registerStyle(register: Register) {
  return register === 'kura'
    ? { unit: 8, heading: FontFamily.heading, mono: FontFamily.mono, body: FontFamily.regular }
    : { unit: 4, heading: FontFamily.monoBold, mono: FontFamily.mono, body: FontFamily.regular };
}
