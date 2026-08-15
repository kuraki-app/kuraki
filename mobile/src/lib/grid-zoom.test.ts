import { describe, expect, it } from 'vitest';

import { GRID_COLUMNS } from '@/lib/prefs';
import { columnsForScale } from '@/lib/grid-zoom';

describe('columnsForScale', () => {
  it('holds the column count while the pinch is negligible', () => {
    expect(columnsForScale(3, 1)).toBe(3);
    expect(columnsForScale(3, 1.05)).toBe(3);
  });

  // Spreading two fingers makes each photo bigger, which means fewer per row.
  it('spreads to fewer, larger columns', () => {
    expect(columnsForScale(4, 2)).toBe(2);
  });

  it('pinches to more, smaller columns', () => {
    expect(columnsForScale(2, 0.5)).toBe(4);
  });

  it('clamps to the range Settings allows', () => {
    expect(columnsForScale(2, 10)).toBe(GRID_COLUMNS.min);
    expect(columnsForScale(6, 0.01)).toBe(GRID_COLUMNS.max);
  });

  // A pinch reported as zero must not divide by it and produce NaN columns.
  it('survives a degenerate scale', () => {
    expect(columnsForScale(3, 0)).toBe(GRID_COLUMNS.max);
    expect(Number.isNaN(columnsForScale(3, 0))).toBe(false);
  });
});
