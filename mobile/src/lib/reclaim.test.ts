import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS, reclaimable, reclaimSummary } from '@/lib/reclaim';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 2); // 2026-08-02

const asset = (id: string, daysOld: number, size = 1_000_000) => ({
  id,
  creationTime: now - daysOld * DAY,
  size,
});

describe('reclaimable', () => {
  it('offers a backed-up asset older than the retention window', () => {
    const got = reclaimable([asset('a', 60)], new Set(['a']), 30, now);
    expect(got.map((a) => a.id)).toEqual(['a']);
  });

  it('never offers an asset that is not in the ledger', () => {
    // The ledger is the only evidence the server has it. Deleting on anything
    // weaker is deleting someone's photo on a guess.
    expect(reclaimable([asset('a', 60)], new Set(), 30, now)).toEqual([]);
  });

  it('keeps a backed-up asset inside the retention window', () => {
    expect(reclaimable([asset('a', 10)], new Set(['a']), 30, now)).toEqual([]);
  });

  it('treats the boundary day as still inside the window', () => {
    // Exactly 30 days old with a 30-day window is kept: the window means "keep
    // for 30 days", and deleting on the last of them is one day early.
    expect(reclaimable([asset('a', 30)], new Set(['a']), 30, now)).toEqual([]);
    expect(reclaimable([asset('a', 31)], new Set(['a']), 30, now)).toHaveLength(1);
  });

  it('offers everything already in the past when retention is zero', () => {
    // Zero is not reachable from RETENTION_DAYS, but the function must still
    // behave sanely if one is stored by an older build. An asset timestamped at
    // exactly `now` is the boundary and is kept — the same fail-closed rule as
    // every other edge here, and unreachable in practice.
    const got = reclaimable([asset('a', 1), asset('b', 400)], new Set(['a', 'b']), 0, now);
    expect(got.map((a) => a.id)).toEqual(['a', 'b']);
    expect(reclaimable([asset('c', 0)], new Set(['c']), 0, now)).toEqual([]);
  });

  it('keeps an asset with no creation time', () => {
    // An undated asset cannot be shown to be outside any window, and the safe
    // reading of "unknown age" is "too recent to touch".
    const undated = { id: 'a', creationTime: undefined, size: 10 };
    expect(reclaimable([undated], new Set(['a']), 30, now)).toEqual([]);
  });

  it('keeps an asset dated in the future', () => {
    // A clock skew or a bad EXIF date must not read as "very old".
    expect(reclaimable([asset('a', -5)], new Set(['a']), 30, now)).toEqual([]);
  });
});

describe('reclaimSummary', () => {
  it('counts and totals what would be freed', () => {
    expect(reclaimSummary([asset('a', 60, 300), asset('b', 90, 700)])).toEqual({
      count: 2,
      bytes: 1000,
    });
  });

  it('is zero for nothing', () => {
    expect(reclaimSummary([])).toEqual({ count: 0, bytes: 0 });
  });

  it('tolerates assets whose size the OS did not report', () => {
    const sizeless = { id: 'a', creationTime: now, size: undefined };
    expect(reclaimSummary([sizeless])).toEqual({ count: 1, bytes: 0 });
  });
});

describe('RETENTION_DAYS', () => {
  it('offers a keep-forever option and defaults to a month', () => {
    expect(RETENTION_DAYS).toContain(30);
    // -1 is "never delete", which must be reachable from the UI: a user who
    // opens this screen and changes their mind needs a way back to safe.
    expect(RETENTION_DAYS[0]).toBe(-1);
  });
});
