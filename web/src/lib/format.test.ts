import { describe, it, expect } from 'vitest';
import { groupAssets, labelGroup, labelDate, fileSize, placeLabel, captureTime } from './format';
import type { Asset } from './types';

// Web had no unit test infrastructure at all, so the timezone bug these
// functions were fixed for was pinned by nothing. The most valuable assertions
// here are the ones that fail if `timeZone: 'UTC'` is ever dropped from the
// formatters in format.ts.

function asset(id: string, takenDay: string): Asset {
  return {
    id,
    taken_day: takenDay,
    created_at: `${takenDay}T12:00:00Z`
  } as Asset;
}

describe('labelDate', () => {
  it('reads back the calendar day it was given, in any timezone', () => {
    // `taken_day` is ALREADY the local day the photo was taken. Parsing it as
    // UTC midnight and then formatting in the viewer's zone moved it backwards
    // for everyone west of Greenwich, so a photo taken on the 1st headlined the
    // previous month. Asserting the day number is what keeps that fix honest.
    expect(labelDate('2024-03-01')).toContain('1');
    expect(labelDate('2024-03-01')).toContain('2024');
    expect(labelDate('2024-03-01')).toMatch(/Mar/);
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(labelDate('not-a-date')).toBe('not-a-date');
  });
});

describe('labelGroup', () => {
  it('renders a year key as itself', () => {
    expect(labelGroup('2024', 'year')).toBe('2024');
  });

  it('renders a month key without slipping to the previous month', () => {
    // The regression this guards: '2024-03' completes to 2024-03-01T00:00:00Z,
    // which is February 29th in any negative-offset zone.
    expect(labelGroup('2024-03', 'month')).toMatch(/March/);
    expect(labelGroup('2024-03', 'month')).toContain('2024');
  });

  it('renders a day key as a full date', () => {
    expect(labelGroup('2024-03-14', 'day')).toMatch(/Mar/);
    expect(labelGroup('2024-03-14', 'day')).toContain('14');
  });

  it('has no heading when grouping is off', () => {
    expect(labelGroup('2024-03-14', 'off')).toBe('');
  });
});

describe('groupAssets', () => {
  const library = [
    asset('a', '2024-03-14'),
    asset('b', '2024-03-14'),
    asset('c', '2024-03-15'),
    asset('d', '2024-07-02'),
    asset('e', '2025-01-09')
  ];

  it('splits by day', () => {
    const groups = groupAssets(library, 'day');
    expect(groups.map((g) => g.key)).toEqual(['2024-03-14', '2024-03-15', '2024-07-02', '2025-01-09']);
    expect(groups[0].items).toHaveLength(2);
  });

  it('splits by month and by year', () => {
    expect(groupAssets(library, 'month').map((g) => g.key)).toEqual(['2024-03', '2024-07', '2025-01']);
    expect(groupAssets(library, 'year').map((g) => g.key)).toEqual(['2024', '2025']);
  });

  it('preserves the server order exactly and never sorts', () => {
    // The server returns assets already ordered; re-sorting here would silently
    // disagree with the cursor pagination that produced them.
    const shuffled = [asset('z', '2025-01-09'), asset('y', '2024-03-14')];
    expect(groupAssets(shuffled, 'day').map((g) => g.key)).toEqual(['2025-01-09', '2024-03-14']);
  });

  it('still blocks the list when grouping is off, so the grid can virtualize', () => {
    // One section holding the whole library would defeat the per-section
    // windowing and put every tile in the DOM at once.
    const many = Array.from({ length: 250 }, (_, i) => asset(`x${i}`, '2024-03-14'));
    const groups = groupAssets(many, 'off');
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.label === '')).toBe(true);
    expect(groups.flatMap((g) => g.items)).toHaveLength(250);
  });

  it('falls back to created_at when a photo has no taken_day', () => {
    const undated = [{ id: 'u', created_at: '2024-05-06T08:00:00Z' } as Asset];
    expect(groupAssets(undated, 'day')[0].key).toBe('2024-05-06');
  });
});

describe('fileSize', () => {
  it('scales units', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2.0 KB');
    expect(fileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(fileSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('placeLabel', () => {
  it('joins city and country, and degrades to whichever exists', () => {
    expect(placeLabel({ place_city: 'Kyoto', place_country: 'Japan' } as Asset)).toBe('Kyoto, Japan');
    expect(placeLabel({ place_city: 'Kyoto' } as Asset)).toBe('Kyoto');
    expect(placeLabel({ place_country: 'Japan' } as Asset)).toBe('Japan');
    expect(placeLabel({} as Asset)).toBe('');
  });
});

describe('captureTime', () => {
  it('agrees with the day heading the photo is filed under', () => {
    // `taken_day` is a string prefix of `taken_at` and `taken_at` is stored
    // UTC, so the day a photo groups under is its UTC date. This suite runs in
    // America/Los_Angeles (see vitest.config.ts), where a late-UTC instant
    // falls on the PREVIOUS local day — exactly the case where a locally
    // formatted viewer disagreed with the heading above it.
    // An EARLY-UTC instant is the one that crosses the date line westward:
    // 02:00Z is the previous evening in Los Angeles (UTC-7). A late-UTC time
    // like 23:30Z does not cross it and would pass either way — the first
    // version of this test used one and proved nothing.
    const iso = '2025-07-01T02:00:00Z';
    const day = iso.slice(0, 10); // what the server sends as taken_day

    // Locale-agnostic on purpose: this suite pins the TIMEZONE, not the locale,
    // and the environment here resolves to en-GB ("1 Jul 2025"), not the US
    // pattern. Asserting every token of the heading appears in the viewer's
    // string states the invariant — same day, same month, same year — without
    // hardcoding either order or punctuation.
    const heading = labelDate(day);
    const shown = captureTime(iso);
    for (const token of heading.split(/[\s,]+/).filter(Boolean)) {
      expect(shown, `viewer shows "${shown}" under a heading of "${heading}"`).toContain(token);
    }
  });

  it('drops the seconds and uses a readable date', () => {
    // `toLocaleString()` produced "6/30/2025, 12:00:00 PM" — the default US
    // pattern with seconds, which is noise on a photograph.
    const formatted = captureTime('2025-06-30T06:30:00Z');
    expect(formatted).not.toMatch(/:\d\d:\d\d/);
    expect(formatted).toMatch(/Jun/);
    expect(formatted).toContain('2025');
  });

  it('returns empty for a value it cannot parse, rather than "Invalid Date"', () => {
    expect(captureTime('not-a-timestamp')).toBe('');
  });
});
