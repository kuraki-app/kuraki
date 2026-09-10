import { describe, expect, it } from 'vitest';

import { captureTimestamp, formatBytes, formatCount, formatDuration, formatTakenAt } from '@/lib/format';

describe('formatBytes', () => {
  it('shows plain bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('steps up at each 1024 boundary', () => {
    // Binary units, matching what a file manager reports for the same library.
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1 PB');
  });

  it('keeps one decimal where it carries information', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.3 GB');
  });

  it('promotes a rounded boundary instead of showing 1024 of the smaller unit', () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe('1 MB');
  });

  it('drops a trailing .0 rather than showing it', () => {
    expect(formatBytes(2 * 1024 ** 2)).toBe('2 MB');
  });

  it('does not fall off the end of the unit list', () => {
    expect(formatBytes(1024 ** 6)).toMatch(/PB$/);
  });

  it('treats negative or non-finite input as zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});

describe('formatCount', () => {
  it('groups thousands so large libraries stay readable', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('tolerates junk', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(-5)).toBe('0');
  });
});

describe('formatTakenAt', () => {
  it('renders a date and a time', () => {
    // Locale-dependent, so assert the parts rather than an exact string.
    const text = formatTakenAt('2026-08-02T14:32:00Z');
    expect(text).toMatch(/2026/);
    expect(text).toContain(' at ');
  });

  it('is empty for an asset with no capture date', () => {
    // The details sheet omits the row entirely rather than showing a
    // placeholder, so a missing date has to come back as an empty string.
    expect(formatTakenAt(undefined)).toBe('');
    expect(formatTakenAt('')).toBe('');
  });

  it('is empty rather than "Invalid Date" for junk', () => {
    expect(formatTakenAt('not-a-date')).toBe('');
  });
});

describe('captureTimestamp', () => {
  it('renders epoch milliseconds as RFC3339', () => {
    expect(captureTimestamp(Date.UTC(2026, 2, 14, 9, 26, 53))).toBe('2026-03-14T09:26:53.000Z');
  });

  it('reads a seconds-scale value as seconds', () => {
    // Android media stores have reported epoch seconds for some entries.
    // Taken at face value that dates the photo to 1970, which is worse than
    // sending nothing at all.
    expect(captureTimestamp(Date.UTC(2026, 2, 14, 9, 26, 53) / 1000)).toBe(
      '2026-03-14T09:26:53.000Z',
    );
  });

  it('is undefined when there is no usable creation time', () => {
    // The upload omits taken_at entirely rather than asserting a wrong date.
    expect(captureTimestamp(undefined)).toBeUndefined();
    expect(captureTimestamp(0)).toBeUndefined();
    expect(captureTimestamp(-1)).toBeUndefined();
    expect(captureTimestamp(Number.NaN)).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('renders under a minute with a zero minute field', () => {
    // The badge in the contact sheet reads "0:57" — the colon stays put.
    expect(formatDuration(57_000)).toBe('0:57');
    expect(formatDuration(1_000)).toBe('0:01');
  });

  it('pads seconds but not minutes', () => {
    expect(formatDuration(64_000)).toBe('1:04');
    expect(formatDuration(724_000)).toBe('12:04');
  });

  it('adds an hours field only past an hour', () => {
    expect(formatDuration(3_599_000)).toBe('59:59');
    expect(formatDuration(5_025_000)).toBe('1:23:45');
  });

  it('returns null when there is nothing to say', () => {
    // A missing field and a zero-length video are indistinguishable on the
    // wire, so neither draws a badge.
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(999)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
