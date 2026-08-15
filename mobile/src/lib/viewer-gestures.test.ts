import { describe, expect, it } from 'vitest';

import { backdropOpacity, clampZoom, shouldDismiss, ZOOM } from '@/lib/viewer-gestures';

describe('clampZoom', () => {
  it('keeps the scale inside the allowed range', () => {
    expect(clampZoom(0.2)).toBe(ZOOM.min);
    expect(clampZoom(99)).toBe(ZOOM.max);
    expect(clampZoom(2)).toBe(2);
  });
});

describe('shouldDismiss', () => {
  it('dismisses on a long drag', () => {
    expect(shouldDismiss(200, 0)).toBe(true);
  });

  // A quick flick is a deliberate throw-away even though the finger barely
  // moved; distance alone would make the gesture feel like it is resisting.
  it('dismisses on a fast flick', () => {
    expect(shouldDismiss(40, 1200)).toBe(true);
  });

  it('springs back from a short slow drag', () => {
    expect(shouldDismiss(30, 0)).toBe(false);
  });

  // Dragging up is not a dismissal. Treating -300 as "far" would close the
  // viewer when the user pulled the opposite way.
  it('ignores an upward drag however fast', () => {
    expect(shouldDismiss(-300, -1200)).toBe(false);
  });
});

describe('backdropOpacity', () => {
  it('is opaque at rest and fades as the photo is dragged away', () => {
    expect(backdropOpacity(0)).toBe(1);
    expect(backdropOpacity(150)).toBeLessThan(1);
    expect(backdropOpacity(150)).toBeGreaterThan(0);
  });

  // Never negative: an opacity below zero is not a valid style value.
  it('bottoms out at zero', () => {
    expect(backdropOpacity(10_000)).toBe(0);
  });
});
