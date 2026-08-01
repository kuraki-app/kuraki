import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, GRID_COLUMNS, GRID_GAP, mergePrefs } from '@/lib/prefs';

describe('mergePrefs', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(mergePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(mergePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(mergePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it('survives corrupt storage instead of throwing', () => {
    // A half-written record or an older app version must never break launch:
    // preferences are cosmetic, so bad data degrades to defaults.
    for (const junk of ['not json', 42, [], true, { gridColumns: 'three' }]) {
      expect(() => mergePrefs(junk)).not.toThrow();
      expect(mergePrefs(junk).gridColumns).toBe(DEFAULT_PREFS.gridColumns);
    }
  });

  it('keeps stored values that are valid', () => {
    const merged = mergePrefs({ backupVideos: false, groupBy: 'year', showGroupHeaders: false });
    expect(merged.backupVideos).toBe(false);
    expect(merged.groupBy).toBe('year');
    expect(merged.showGroupHeaders).toBe(false);
    // Everything not stored still falls back.
    expect(merged.backupPhotos).toBe(DEFAULT_PREFS.backupPhotos);
  });

  it('clamps grid columns to a usable range', () => {
    expect(mergePrefs({ gridColumns: 0 }).gridColumns).toBe(GRID_COLUMNS.min);
    expect(mergePrefs({ gridColumns: 99 }).gridColumns).toBe(GRID_COLUMNS.max);
    expect(mergePrefs({ gridColumns: 4 }).gridColumns).toBe(4);
    // A fractional column count would produce fractional tile widths.
    expect(mergePrefs({ gridColumns: 3.7 }).gridColumns).toBe(4);
  });

  it('clamps the grid gap', () => {
    expect(mergePrefs({ gridGap: -5 }).gridGap).toBe(GRID_GAP.min);
    expect(mergePrefs({ gridGap: 500 }).gridGap).toBe(GRID_GAP.max);
    expect(mergePrefs({ gridGap: 6 }).gridGap).toBe(6);
  });

  it('rejects a groupBy value outside the union', () => {
    expect(mergePrefs({ groupBy: 'decade' }).groupBy).toBe(DEFAULT_PREFS.groupBy);
  });

  it('ignores keys it does not know', () => {
    const merged = mergePrefs({ somethingRemoved: true, gridGap: 4 });
    expect(merged).not.toHaveProperty('somethingRemoved');
    expect(merged.gridGap).toBe(4);
  });

  it('coerces booleans rather than passing through truthy junk', () => {
    expect(mergePrefs({ backupPhotos: 'no' }).backupPhotos).toBe(DEFAULT_PREFS.backupPhotos);
  });
});
