/**
 * Pure logic for painting a selection by dragging across the grid.
 *
 * It lives here rather than inside photo-grid.tsx because this is the part
 * worth testing and the component is not testable: `mobile/` has no React
 * Native render harness, so anything written inside a component is verified
 * only by eye on a simulator. Hit-testing arithmetic is exactly the kind of
 * thing that is wrong by one row and still looks approximately right.
 */

export type Point = { x: number; y: number };

/** A tile's box in the list's *content* coordinates, as captured on layout. */
export type TileFrame = { id: string; x: number; y: number; w: number; h: number };

export type PaintMode = 'select' | 'deselect';

/**
 * tileAt returns the id of the tile under `point`, or null for a gap or a miss.
 *
 * `scrollDelta` is how far the list has scrolled since the frames were
 * captured. The finger is reported in viewport coordinates and the frames are
 * stored in content coordinates, and this is the only thing bridging the two.
 *
 * Boxes are half-open (`>= x`, `< x + w`) so a point on the seam between two
 * tiles belongs to exactly one of them.
 */
export function tileAt(point: Point, frames: TileFrame[], scrollDelta: number): string | null {
  const y = point.y + scrollDelta;
  for (const f of frames) {
    if (point.x >= f.x && point.x < f.x + f.w && y >= f.y && y < f.y + f.h) return f.id;
  }
  return null;
}

/**
 * paintMode decides what a drag does, from the state of the tile it starts on.
 *
 * Starting on an unselected tile means the user is adding to the selection;
 * starting on a selected one means they are taking away. Fixing the mode once
 * at the start is what makes the gesture predictable — a per-tile toggle would
 * flip tiles back as the finger wandered over them a second time.
 */
export function paintMode(alreadySelected: boolean): PaintMode {
  return alreadySelected ? 'deselect' : 'select';
}

/** applyPaint returns a new set with `id` forced to match `mode`. */
export function applyPaint(selected: Set<string>, id: string, mode: PaintMode): Set<string> {
  const next = new Set(selected);
  if (mode === 'select') next.add(id);
  else next.delete(id);
  return next;
}
