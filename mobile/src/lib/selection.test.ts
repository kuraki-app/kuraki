import { describe, expect, it } from 'vitest';
import { allFavorite, sectionAllSelected, sectionIds } from '@/lib/selection';

const asset = (id: string, favorite = false) => ({ id, favorite });

// Two rows of two, the shape groupAssets produces for a 4-photo month at
// columns=2.
const section = {
  data: [
    [asset('a'), asset('b')],
    [asset('c'), asset('d')],
  ],
};

describe('allFavorite', () => {
  it('is false when only some of the selection is favourite', () => {
    const assets = [asset('a', true), asset('b', false)];
    expect(allFavorite(assets, new Set(['a', 'b']))).toBe(false);
  });

  it('is true when every selected asset is already favourite', () => {
    const assets = [asset('a', true), asset('b', true), asset('c', false)];
    // 'c' is unfavourited but unselected, so it must not drag the answer down.
    expect(allFavorite(assets, new Set(['a', 'b']))).toBe(true);
  });

  it('is false for an empty selection', () => {
    // Vacuous truth would label the button "Unfavourite" with nothing chosen.
    expect(allFavorite([asset('a', true)], new Set())).toBe(false);
  });

  it('ignores selected ids that are not in the list', () => {
    // The list is one page; a selection can outlive the page it was made on.
    expect(allFavorite([asset('a', true)], new Set(['a', 'gone']))).toBe(true);
  });
});

describe('sectionIds', () => {
  it('flattens the section rows in order', () => {
    expect(sectionIds(section)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is empty for a section with no rows', () => {
    expect(sectionIds({ data: [] })).toEqual([]);
  });
});

describe('sectionAllSelected', () => {
  it('is false while any tile in the group is unselected', () => {
    expect(sectionAllSelected(section, new Set(['a', 'b', 'c']))).toBe(false);
  });

  it('is true once every tile in the group is selected', () => {
    expect(sectionAllSelected(section, new Set(['a', 'b', 'c', 'd']))).toBe(true);
  });

  it('is false for an empty section', () => {
    // Otherwise an empty group would render "None", offering to clear nothing.
    expect(sectionAllSelected({ data: [] }, new Set())).toBe(false);
  });
});
