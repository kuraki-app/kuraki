import { describe, expect, it } from 'vitest';

import { formatBytes, formatCount, formatTakenAt } from '@/lib/format';

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
  });

  it('keeps one decimal where it carries information', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.3 GB');
  });

  it('drops a trailing .0 rather than showing it', () => {
    expect(formatBytes(2 * 1024 ** 2)).toBe('2 MB');
  });

  it('does not fall off the end of the unit list', () => {
    // A petabyte library is absurd, but the formatter must not print undefined.
    expect(formatBytes(1024 ** 6)).toMatch(/TB$/);
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
