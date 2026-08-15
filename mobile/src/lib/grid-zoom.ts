import { GRID_COLUMNS } from '@/lib/prefs';

/**
 * columnsForScale maps a live pinch onto a column count.
 *
 * The relationship is inverse on purpose: a pinch scale above 1 means the
 * fingers spread apart, which should make each photo *bigger*, and bigger
 * photos mean fewer of them per row. Rounding rather than flooring means the
 * grid changes as the gesture passes the halfway point between two counts,
 * which is where it looks like it ought to change.
 *
 * The result is clamped to the same GRID_COLUMNS range Settings > Photo Grid
 * enforces, so the gesture and the setting cannot disagree about what is valid.
 */
export function columnsForScale(startColumns: number, scale: number): number {
  // A scale reported as 0 — or negative, which never happens but costs nothing
  // to exclude — would send this to Infinity and then to a NaN column count.
  const safe = scale > 0.01 ? scale : 0.01;
  const next = Math.round(startColumns / safe);
  return Math.min(GRID_COLUMNS.max, Math.max(GRID_COLUMNS.min, next));
}
