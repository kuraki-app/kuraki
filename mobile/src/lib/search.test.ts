import { describe, expect, it } from 'vitest';

import { SEARCH_CHIPS, searchFilters } from '@/lib/search';

describe('searchFilters', () => {
  it('maps each chip to its filter', () => {
    expect(searchFilters(0, '')).toEqual({});
    expect(searchFilters(1, '')).toEqual({ type: 'image' });
    expect(searchFilters(2, '')).toEqual({ type: 'video' });
    expect(searchFilters(3, '')).toEqual({ favorite: true });
  });

  it('adds a trimmed query alongside the chip filter', () => {
    expect(searchFilters(1, '  beach  ')).toEqual({ type: 'image', q: 'beach' });
  });

  it('omits an empty or whitespace-only query', () => {
    expect(searchFilters(0, '   ')).toEqual({});
    expect(searchFilters(3, '')).toEqual({ favorite: true });
  });

  it('falls back to the first chip when the index is out of range', () => {
    // Guards against a stale index after the chip list changes.
    expect(searchFilters(99, 'x')).toEqual({ q: 'x' });
    expect(searchFilters(-1, '')).toEqual({});
  });

  it('exposes a chip list the screen can render', () => {
    expect(SEARCH_CHIPS.map((c) => c.label)).toEqual(['All', 'Photos', 'Videos', 'Favorites']);
  });
});
