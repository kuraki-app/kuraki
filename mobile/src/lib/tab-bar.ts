// Geometry shared by the tab bar and every screen that scrolls underneath it.
// Screens add TAB_BAR_HEIGHT + insets.bottom to their content padding so the
// last row clears the bar instead of hiding behind it.
export const TAB_BAR_HEIGHT = 64;

// Per-event scroll deltas, in points. Collapsing needs a firmer push than
// expanding: it is better to re-expand eagerly than to leave the user without
// visible navigation. Both are expected to want tuning on real hardware.
export const COLLAPSE_THRESHOLD = 12;
export const EXPAND_THRESHOLD = 8;

// How long scrolling must pause before the pill counts as idle.
export const IDLE_MS = 150;

export type PillState = 'expanded' | 'collapsed';

/**
 * nextPillState decides whether the left pill shows all three destinations or
 * only the active one. Kept pure so the behaviour is testable without a scroll
 * view: the component supplies events, this decides the state.
 *
 * Rules are ordered — the first that matches wins.
 */
export function nextPillState(
  current: PillState,
  event: { dy: number; atTop: boolean; idle: boolean },
): PillState {
  if (event.atTop) return 'expanded'; // never collapsed at rest at the top
  if (event.idle) return 'expanded'; // scrolling stopped
  if (event.dy > COLLAPSE_THRESHOLD) return 'collapsed';
  if (event.dy < -EXPAND_THRESHOLD) return 'expanded';
  return current;
}
