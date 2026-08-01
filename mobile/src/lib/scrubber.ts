// Geometry for the fast-scroll scrubber. Kept separate from the component so
// the mapping between scroll offset, track position and thumb placement can be
// tested without a scroll view — the parts most likely to be wrong are the
// clamps, and those are exactly what a device makes tedious to check.

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** How far through the list a given scroll offset is, as 0..1. */
export function progressForOffset(offsetY: number, contentHeight: number, layoutHeight: number): number {
  const scrollable = contentHeight - layoutHeight;
  // Content shorter than the viewport cannot scroll, so every offset is "top".
  if (scrollable <= 0) return 0;
  // iOS reports negative offsets while rubber-banding past the top, and
  // offsets past the maximum at the bottom; both must clamp.
  return clamp01(offsetY / scrollable);
}

/** The scroll offset that puts the list at `progress` (0..1) through its content. */
export function offsetForProgress(progress: number, contentHeight: number, layoutHeight: number): number {
  const scrollable = contentHeight - layoutHeight;
  if (scrollable <= 0) return 0;
  return clamp01(progress) * scrollable;
}

/** Progress for a touch at `y` on a track of `trackHeight`, given the thumb's size. */
export function scrubProgress(y: number, trackHeight: number, thumbHeight: number): number {
  const usable = trackHeight - thumbHeight;
  if (usable <= 0) return 0;
  return clamp01(y / usable);
}

/** Where the thumb's top edge sits for a given progress, never leaving the track. */
export function thumbTop(progress: number, trackHeight: number, thumbHeight: number): number {
  const usable = Math.max(0, trackHeight - thumbHeight);
  return clamp01(progress) * usable;
}
