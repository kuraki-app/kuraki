// Binary units, so a library's reported size matches what a file manager shows
// for the same folder rather than being ~7% larger.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * formatBytes renders a byte count for display: "0 B", "1.5 KB", "2.3 GB".
 *
 * One decimal, but only where it carries information — "2 MB" reads better
 * than "2.0 MB". Clamps at TB rather than walking off the unit list, and
 * treats negative or non-finite input as zero so a missing field from the
 * server cannot render "NaN undefined" in the UI.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = Math.round(value * 10) / 10;
  // Integers print without a decimal; 2 MB, not 2.0 MB.
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

/** formatCount groups thousands so a large library's totals stay readable. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  return Math.round(count).toLocaleString('en-US');
}

/**
 * formatTakenAt renders an asset's capture time for the viewer's details
 * sheet: "2 August 2026 at 14:32".
 *
 * The server sends `taken_at` as an ISO string, and it is optional — an import
 * with no EXIF date has none. An empty string rather than a thrown error or an
 * "Invalid Date" is what the sheet wants: the row is simply omitted.
 */
export function formatTakenAt(iso: string | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const date = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} at ${time}`;
}
