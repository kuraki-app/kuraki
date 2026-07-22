// OpenFreeMap vector styles — free, no API key, self-hostable later. `liberty`
// is the full-colour style; `positron` is the muted light-grey style we lean on
// for dark mode (OpenFreeMap has no dedicated dark style; positron reads best
// under our dark chrome). Swap these to a self-hosted style URL to go fully
// offline-of-third-parties.
export const PLACES_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
export const PLACES_STYLE_DARK = 'https://tiles.openfreemap.org/styles/positron';

// Accepts React Native's ColorSchemeName ('light' | 'dark' | 'unspecified' |
// null | undefined); anything but an explicit 'dark' falls back to the light style.
export function mapStyleForScheme(scheme: string | null | undefined): string {
  return scheme === 'dark' ? PLACES_STYLE_DARK : PLACES_STYLE_LIGHT;
}
