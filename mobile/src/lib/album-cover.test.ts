import { describe, expect, it } from 'vitest';

import { coverLayout, MOSAIC_TILES } from '@/lib/album-cover';

describe('coverLayout', () => {
  it('draws a mosaic once there are enough photos to fill it', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(coverLayout(ids)).toEqual({ kind: 'mosaic', ids });
  });

  // The server caps what it sends, but the client must not depend on that: a
  // longer list is trimmed rather than overflowing the 2x2.
  it('takes only the first MOSAIC_TILES ids', () => {
    const layout = coverLayout(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(layout).toEqual({ kind: 'mosaic', ids: ['a', 'b', 'c', 'd'] });
    expect(layout.ids).toHaveLength(MOSAIC_TILES);
  });

  // A partly-filled mosaic reads as a loading failure rather than as a small
  // album, so anything short of a full grid shows one photo edge to edge.
  it('falls back to a single photo when the grid cannot be filled', () => {
    expect(coverLayout(['a'])).toEqual({ kind: 'single', ids: ['a'] });
    expect(coverLayout(['a', 'b'])).toEqual({ kind: 'single', ids: ['a'] });
    expect(coverLayout(['a', 'b', 'c'])).toEqual({ kind: 'single', ids: ['a'] });
  });

  it('has nothing to draw for an empty album', () => {
    expect(coverLayout([])).toEqual({ kind: 'empty', ids: [] });
  });

  // The field is `required` in the contract, but the offline cache predates it
  // and a row written by an older build has no ids at all.
  it('treats a missing list as empty rather than throwing', () => {
    expect(coverLayout(undefined)).toEqual({ kind: 'empty', ids: [] });
  });
});
