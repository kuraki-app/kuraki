import { describe, expect, it } from 'vitest';

import { offsetForProgress, progressForOffset, scrubProgress, thumbTop } from '@/lib/scrubber';

describe('progressForOffset', () => {
  it('is 0 at the top and 1 at the bottom', () => {
    expect(progressForOffset(0, 3000, 800)).toBe(0);
    expect(progressForOffset(2200, 3000, 800)).toBe(1);
  });

  it('is proportional in between', () => {
    expect(progressForOffset(1100, 3000, 800)).toBeCloseTo(0.5);
  });

  it('clamps rubber-band overscroll at both ends', () => {
    // iOS reports negative offsets when bouncing past the top and offsets
    // beyond the maximum at the bottom; neither may push the thumb off track.
    expect(progressForOffset(-120, 3000, 800)).toBe(0);
    expect(progressForOffset(9999, 3000, 800)).toBe(1);
  });

  it('is 0 when the content is shorter than the viewport', () => {
    // No scrolling is possible, so there is no meaningful position.
    expect(progressForOffset(0, 500, 800)).toBe(0);
    expect(progressForOffset(50, 500, 800)).toBe(0);
  });
});

describe('offsetForProgress', () => {
  it('inverts progressForOffset', () => {
    expect(offsetForProgress(0, 3000, 800)).toBe(0);
    expect(offsetForProgress(1, 3000, 800)).toBe(2200);
    expect(offsetForProgress(0.5, 3000, 800)).toBeCloseTo(1100);
  });

  it('never returns a negative offset', () => {
    expect(offsetForProgress(0, 500, 800)).toBe(0);
    expect(offsetForProgress(1, 500, 800)).toBe(0);
  });
});

describe('scrubProgress', () => {
  it('maps a touch position on the track to progress', () => {
    expect(scrubProgress(0, 400, 40)).toBe(0);
    expect(scrubProgress(360, 400, 40)).toBe(1);
    expect(scrubProgress(180, 400, 40)).toBeCloseTo(0.5);
  });

  it('clamps a drag beyond either end of the track', () => {
    expect(scrubProgress(-50, 400, 40)).toBe(0);
    expect(scrubProgress(999, 400, 40)).toBe(1);
  });

  it('does not divide by zero on a degenerate track', () => {
    expect(scrubProgress(10, 40, 40)).toBe(0);
    expect(scrubProgress(10, 0, 40)).toBe(0);
  });
});

describe('thumbTop', () => {
  it('keeps the thumb inside the track', () => {
    expect(thumbTop(0, 400, 40)).toBe(0);
    expect(thumbTop(1, 400, 40)).toBe(360);
    expect(thumbTop(0.5, 400, 40)).toBeCloseTo(180);
  });
});
