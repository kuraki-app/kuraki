import { describe, expect, it } from 'vitest';

import type { LibraryAsset } from '@/lib/library-api';
import { memoryGroups } from '@/lib/memories';

function asset(id: string, takenAt: string | undefined): LibraryAsset {
  return {
    id,
    filename: `${id}.jpg`,
    media_type: 'image',
    taken_at: takenAt,
    taken_day: takenAt?.slice(0, 10),
    favorite: false,
    web_viewable: true,
  } as LibraryAsset;
}

const NOW = new Date('2026-09-07T12:00:00Z');

describe('memoryGroups', () => {
  it('collapses a year into one card and counts the rest', () => {
    const groups = memoryGroups(
      [
        asset('a', '2019-09-07T18:00:00Z'),
        asset('b', '2019-09-07T09:00:00Z'),
        asset('c', '2019-09-07T08:00:00Z'),
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    // Newest first on the wire, so the first asset seen is the cover.
    expect(groups[0].cover.id).toBe('a');
  });

  it('orders newest year first', () => {
    const groups = memoryGroups(
      [asset('a', '2024-09-07T10:00:00Z'), asset('b', '2019-09-07T10:00:00Z'), asset('c', '2021-09-07T10:00:00Z')],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(['2024', '2021', '2019']);
  });

  it('names the distance the way a person would', () => {
    const groups = memoryGroups(
      [asset('b', '2025-09-07T10:00:00Z'), asset('c', '2021-09-07T10:00:00Z')],
      NOW,
    );

    expect(groups.map((g) => g.title)).toEqual(['Last year', '5 years ago']);
    // The absolute year is always carried too, so the relative label is never
    // the only anchor.
    expect(groups.map((g) => g.subtitle)).toEqual(['2025', '2021']);
  });

  it('drops the current year, which is just today', () => {
    // The feed is "this day across every year". For the current year that is
    // today, and today is already the top of the timeline under the rail —
    // on device the same photograph rendered twice.
    const groups = memoryGroups(
      [asset('today', '2026-09-07T10:00:00Z'), asset('old', '2021-09-07T10:00:00Z')],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(['2021']);
  });

  it('drops undated assets rather than bucketing them under this year', () => {
    const groups = memoryGroups([asset('a', undefined), asset('b', '2020-09-07T10:00:00Z')], NOW);

    expect(groups.map((g) => g.key)).toEqual(['2020']);
  });

  it('drops a future-dated asset rather than rendering a negative distance', () => {
    // A camera with a wrong clock produces these routinely.
    expect(memoryGroups([asset('a', '2029-09-07T10:00:00Z')], NOW)).toEqual([]);
  });

  it('returns nothing for an empty page', () => {
    expect(memoryGroups([], NOW)).toEqual([]);
  });
});
