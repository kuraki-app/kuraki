/**
 * How an album's cover is drawn, decided from the asset ids the server sent.
 *
 * Pure and tested here rather than inline in album-list.tsx for the usual
 * reason: `mobile/` has no React Native render harness, so a rule left inside a
 * component is checked by eye and nowhere else.
 */

/** Tiles in the mosaic — 2x2. */
export const MOSAIC_TILES = 4;

export type CoverLayout = {
  kind: 'mosaic' | 'single' | 'empty';
  ids: string[];
};

/**
 * coverLayout picks between a 2x2 mosaic, one full-bleed photo, and nothing.
 *
 * The mosaic needs every cell filled. A three-photo album drawn as three
 * thumbnails and one grey square does not read as "a small album" — it reads as
 * an image that failed to load, which is worse than not having a mosaic at all.
 * So anything short of a full grid falls back to a single photo, which is what
 * an album cover looked like before mosaics existed and is never ambiguous.
 *
 * `ids` may be undefined: the field is `required` in the contract, but the
 * offline album cache predates it and rows written by an older build carry
 * nothing.
 */
export function coverLayout(ids: string[] | undefined): CoverLayout {
  const available = ids ?? [];
  if (available.length >= MOSAIC_TILES) {
    return { kind: 'mosaic', ids: available.slice(0, MOSAIC_TILES) };
  }
  if (available.length > 0) return { kind: 'single', ids: [available[0]] };
  return { kind: 'empty', ids: [] };
}
