/**
 * Thresholds and clamps for the viewer's gestures, kept out of the component
 * for the same reason as drag-select: `mobile/` has no React Native render
 * harness, so this is the only layer of the gesture that can be tested at all.
 */

/** The zoom range a photo can be pinched to. 1 is fit-to-screen. */
export const ZOOM = { min: 1, max: 4 } as const;

/** How far down the photo must be dragged to count as a dismissal, in points. */
const DISMISS_DISTANCE = 120;
/** ...or how fast it must be thrown, in points per second. */
const DISMISS_VELOCITY = 800;
/** The drag distance over which the backdrop fades fully out. */
const FADE_DISTANCE = 400;

export function clampZoom(scale: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, scale));
}

/**
 * shouldDismiss decides, on release, whether a downward drag closes the viewer.
 *
 * Distance *or* velocity: a slow deliberate pull and a quick flick are both
 * ways of saying "put this away", and requiring distance alone makes the
 * gesture feel like it is resisting. Upward movement never dismisses — this is
 * a downward gesture, and treating a large negative translation as "far" would
 * close the viewer when the user pulled the wrong way.
 */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  if (translationY <= 0) return false;
  return translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY;
}

/** backdropOpacity fades the black behind the photo as it is dragged away. */
export function backdropOpacity(translationY: number): number {
  const travelled = Math.abs(translationY);
  return Math.max(0, 1 - travelled / FADE_DISTANCE);
}
