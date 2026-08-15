import { describe, expect, it } from 'vitest';

import { applyPaint, paintMode, tileAt, type TileFrame } from '@/lib/drag-select';

// A 2-column grid of 100x100 tiles, captured at scroll offset 0.
const FRAMES: TileFrame[] = [
  { id: 'a', x: 0, y: 0, w: 100, h: 100 },
  { id: 'b', x: 100, y: 0, w: 100, h: 100 },
  { id: 'c', x: 0, y: 100, w: 100, h: 100 },
];

describe('tileAt', () => {
  it('finds the tile under a point', () => {
    expect(tileAt({ x: 50, y: 50 }, FRAMES, 0)).toBe('a');
    expect(tileAt({ x: 150, y: 50 }, FRAMES, 0)).toBe('b');
  });

  it('returns null past the end of the grid and outside it', () => {
    expect(tileAt({ x: 50, y: 500 }, FRAMES, 0)).toBeNull();
    expect(tileAt({ x: -10, y: 50 }, FRAMES, 0)).toBeNull();
  });

  // Frames are captured once on layout, but the list scrolls underneath the
  // finger. Without the delta the drag would keep painting whatever happened to
  // be at that screen position when the grid first laid out.
  it('shifts by how far the list has scrolled since capture', () => {
    expect(tileAt({ x: 50, y: 50 }, FRAMES, 100)).toBe('c');
  });

  // Edges belong to exactly one tile: the boundary between two tiles must not
  // report both, or a drag along it would paint twice as fast as it looks.
  it('treats a tile as half-open on both axes', () => {
    expect(tileAt({ x: 100, y: 0 }, FRAMES, 0)).toBe('b');
    expect(tileAt({ x: 99.9, y: 0 }, FRAMES, 0)).toBe('a');
  });
});

describe('paintMode', () => {
  // The first tile decides the whole drag: starting on an unselected tile means
  // the user is adding, starting on a selected one means they are removing.
  it('is decided by the first tile the drag touches', () => {
    expect(paintMode(false)).toBe('select');
    expect(paintMode(true)).toBe('deselect');
  });
});

describe('applyPaint', () => {
  it('adds in select mode and removes in deselect mode', () => {
    expect([...applyPaint(new Set(['a']), 'b', 'select')]).toEqual(['a', 'b']);
    expect([...applyPaint(new Set(['a', 'b']), 'b', 'deselect')]).toEqual(['a']);
  });

  // Dragging back over your own path must not undo the drag.
  it('is idempotent within a drag', () => {
    const once = applyPaint(new Set<string>(), 'a', 'select');
    expect([...applyPaint(once, 'a', 'select')]).toEqual(['a']);
  });

  it('does not mutate the input set', () => {
    const before = new Set(['a']);
    applyPaint(before, 'b', 'select');
    expect([...before]).toEqual(['a']);
  });
});
