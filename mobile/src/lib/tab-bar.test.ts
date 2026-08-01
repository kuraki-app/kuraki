import { describe, expect, it } from 'vitest';

import { COLLAPSE_THRESHOLD, EXPAND_THRESHOLD, nextPillState, type PillState } from '@/lib/tab-bar';

const at = (o: Partial<{ dy: number; atTop: boolean; idle: boolean }> = {}) => ({
  dy: 0,
  atTop: false,
  idle: false,
  ...o,
});

describe('nextPillState', () => {
  it('stays expanded at the top of a list', () => {
    // Rule 1 wins over everything: a rubber-band bounce at the top reports a
    // large positive dy, and must not collapse the pill.
    expect(nextPillState('expanded', at({ atTop: true, dy: 999 }))).toBe('expanded');
    expect(nextPillState('collapsed', at({ atTop: true, dy: 999 }))).toBe('expanded');
  });

  it('re-expands when scrolling stops', () => {
    expect(nextPillState('collapsed', at({ idle: true }))).toBe('expanded');
  });

  it('collapses when scrolling down past the threshold', () => {
    expect(nextPillState('expanded', at({ dy: COLLAPSE_THRESHOLD + 1 }))).toBe('collapsed');
  });

  it('ignores downward scroll below the threshold', () => {
    expect(nextPillState('expanded', at({ dy: COLLAPSE_THRESHOLD - 1 }))).toBe('expanded');
  });

  it('re-expands when scrolling up past the threshold', () => {
    expect(nextPillState('collapsed', at({ dy: -(EXPAND_THRESHOLD + 1) }))).toBe('expanded');
  });

  it('ignores upward scroll below the threshold', () => {
    expect(nextPillState('collapsed', at({ dy: -(EXPAND_THRESHOLD - 1) }))).toBe('collapsed');
  });

  it('is idempotent for a neutral event', () => {
    for (const s of ['expanded', 'collapsed'] as PillState[]) {
      expect(nextPillState(s, at())).toBe(s);
    }
  });
});
