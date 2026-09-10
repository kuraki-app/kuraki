import { describe, expect, it } from 'vitest';
import { gridGeometry, gridWindows } from './gallery-layout';

it('accounts for gutters at column breakpoints', () => {
  expect(gridGeometry(404, 132, 4)).toEqual({ columns: 3, tile: 132 });
  expect(gridGeometry(403, 132, 4).columns).toBe(2);
});

describe('large date groups', () => {
  for (const width of [320, 390, 820, 1440]) {
    it(`preserves row alignment and exact scroll height at ${width}px`, () => {
      const items = Array.from({ length: 10000 }, (_, i) => i);
      const { columns, tile } = gridGeometry(width, 132, 4);
      const windows = gridWindows(items, columns, tile, 4);
      expect(windows.flatMap((w) => w.items)).toEqual(items);
      expect(Math.max(...windows.map((w) => w.items.length))).toBeLessThanOrEqual(columns * 6);
      const rows = Math.ceil(items.length / columns);
      const actual = windows.reduce((sum, w) => sum + w.height, 0) + (windows.length - 1) * 4;
      expect(actual).toBeCloseTo(rows * tile + (rows - 1) * 4, 6);
    });
  }
});
