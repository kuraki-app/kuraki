import { describe, expect, it } from 'vitest';

import type { LibraryAsset } from '@/lib/library-api';
import { GALLERY_VIEWS, galleryTitle, groupAssets, groupLabel } from '@/lib/gallery';

const asset = (id: string, taken_day?: string): LibraryAsset => ({
  id,
  filename: `${id}.jpg`,
  media_type: 'image',
  favorite: false,
  web_viewable: true,
  taken_day,
});

describe('galleryTitle', () => {
  it('names each view', () => {
    expect(galleryTitle('timeline')).toBe('Photos');
    expect(galleryTitle('memories')).toBe('On this day');
    expect(galleryTitle('places')).toBe('Places');
  });

  it('covers every view listed in the menu', () => {
    for (const v of GALLERY_VIEWS) expect(galleryTitle(v.key)).toBe(v.label);
  });
});

describe('groupLabel', () => {
  it('formats a month and a year', () => {
    expect(groupLabel('2026-08-14', 'month')).toBe('August 2026');
    expect(groupLabel('2026-08-14', 'year')).toBe('2026');
  });

  it('is stable regardless of the machine timezone', () => {
    // Parsed as calendar parts, not through Date's UTC conversion — otherwise
    // the first of a month renders as the previous month west of Greenwich.
    expect(groupLabel('2026-01-01', 'month')).toBe('January 2026');
    expect(groupLabel('2026-12-31', 'month')).toBe('December 2026');
  });
});

describe('groupAssets', () => {
  it('chunks into rows of the given column count', () => {
    const sections = groupAssets([asset('a'), asset('b'), asset('c'), asset('d')], 'off', 3);
    expect(sections).toHaveLength(1);
    expect(sections[0].data.map((row) => row.map((a) => a.id))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('produces one untitled section when grouping is off', () => {
    const sections = groupAssets([asset('a', '2026-08-01')], 'off', 3);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('');
  });

  it('splits into month sections and never mixes months in a row', () => {
    const sections = groupAssets(
      [
        asset('a', '2026-08-20'),
        asset('b', '2026-08-19'),
        asset('c', '2026-07-30'),
        asset('d', '2026-07-29'),
      ],
      'month',
      3,
    );
    expect(sections.map((s) => s.title)).toEqual(['August 2026', 'July 2026']);
    // A row must never straddle a boundary, or a header would sit mid-row.
    expect(sections[0].data).toEqual([[expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })]]);
    expect(sections[1].data).toHaveLength(1);
  });

  it('groups by year when asked', () => {
    const sections = groupAssets(
      [asset('a', '2026-08-20'), asset('b', '2026-01-02'), asset('c', '2025-11-11')],
      'year',
      3,
    );
    expect(sections.map((s) => s.title)).toEqual(['2026', '2025']);
    expect(sections[0].data[0]).toHaveLength(2);
  });

  it('gathers undated assets under one section rather than dropping them', () => {
    const sections = groupAssets([asset('a'), asset('b', '2026-08-01')], 'month', 3);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('August 2026');
    expect(titles).toContain('Undated');
    expect(sections.flatMap((s) => s.data.flat())).toHaveLength(2);
  });

  it('returns no sections for an empty library', () => {
    expect(groupAssets([], 'month', 3)).toEqual([]);
    expect(groupAssets([], 'off', 3)).toEqual([]);
  });

  it('gives every section a unique key', () => {
    const sections = groupAssets(
      [asset('a', '2026-08-20'), asset('b', '2026-07-30'), asset('c')],
      'month',
      3,
    );
    const keys = sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the Archived view', () => {
  it('names itself in the header', () => {
    expect(galleryTitle('archived')).toBe('Archived');
  });

  it('is offered alongside the other views', () => {
    expect(GALLERY_VIEWS.map((v) => v.key)).toEqual(['timeline', 'memories', 'places', 'archived']);
  });
});
