import type { Asset } from './types';

// timeZone: 'UTC' is load-bearing, not tidiness.
//
// `taken_day` is already the local calendar day the photo was taken. Parsing it
// as `${day}T00:00:00Z` produces UTC midnight, and formatting that instant in
// the viewer's own zone moves it backwards for everyone west of Greenwich — so
// every photo taken on the 1st of a month headlined the previous month, and a
// day heading could disagree with the date the viewer shows for the same photo.
// Formatting in UTC reads the parts back out exactly as they went in.
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
});

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// A capture instant, for the viewer's detail panel.
//
// `toLocaleString()` gave "6/30/2025, 12:00:00 PM" — the default US pattern
// with seconds, which is noise on a photograph.
//
// timeZone: 'UTC' for the same reason the formatters above use it, and the
// reason is not stylistic. The server derives `taken_day` as a STRING PREFIX of
// `taken_at` (httpapi/assets.go: `row.TakenAt.String[:10]`), and `taken_at` is
// stored UTC — so the day a photo groups under is its UTC date. Formatting the
// same instant in the viewer's own zone made the panel disagree with the day
// heading it sits directly under: a photo filed on "Jun 30" could read
// "Jul 1, 1:30 AM" for anyone far enough east.
//
// It is also the more accurate reading of what the value holds. EXIF's
// DateTimeOriginal carries no zone — it is the camera's wall-clock time — and
// the importer stores it via `taken.UTC()`, so for any photo with EXIF the
// stored instant IS the local time it was taken. Rendering that in UTC hands
// it back unchanged, which is what every photo application shows.
//
// The residual limitation, stated plainly: no capture offset is stored
// anywhere, so a photo dated from the file's modification time (the fallback
// for media with no EXIF at all) is a true instant and will read in UTC rather
// than in the zone it was taken in. Fixing that properly means storing the
// offset at import, which is a schema change and a migration, not a formatting
// choice.
const captureFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC'
});

export function captureTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return captureFormatter.format(parsed);
}

export function labelDate(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return dateFormatter.format(parsed);
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function durationLabel(ms: number): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function placeLabel(asset: Asset): string {
  if (asset.place_city && asset.place_country) return `${asset.place_city}, ${asset.place_country}`;
  return asset.place_city || asset.place_country || '';
}

/** How the timeline splits into headed sections. */
export type Grouping = 'day' | 'month' | 'year' | 'off';

export const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'off', label: 'Off' }
];

export type AssetGroup = { key: string; label: string; items: Asset[] };

/** Assets per unheaded block when grouping is off — see groupAssets. Sized to
 *  a few rows at any density, so a block is cheap to mount and unmount. */
const UNGROUPED_BLOCK = 120;

/** labelGroup renders a group key as its heading. */
export function labelGroup(key: string, grouping: Grouping): string {
  if (grouping === 'off' || !key) return '';
  if (grouping === 'year') return key;
  // Both remaining cases start from a full ISO day so one parse serves both;
  // a month key is completed to its first day purely to have something to
  // parse, and only the month and year are ever rendered from it.
  const parsed = new Date(grouping === 'month' ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return key;
  return grouping === 'month' ? monthFormatter.format(parsed) : dateFormatter.format(parsed);
}

/**
 * groupAssets splits an already date-sorted list into the sections the grid
 * renders. It only inserts boundaries — the server's order is preserved
 * exactly, and nothing here sorts.
 *
 * Keys are cut from the ISO date string rather than via `new Date`, because a
 * Date round-trip re-interprets `taken_day` in the viewer's timezone and can
 * move a photo into the previous month. See the formatters above.
 */
export function groupAssets(assets: Asset[], grouping: Grouping): AssetGroup[] {
  if (grouping === 'off') {
    // Still cut into blocks, with no headings.
    //
    // The grid virtualizes per section, so one section holding the whole
    // library would put every tile in the DOM at once — which is exactly the
    // lock-up the windowing exists to prevent. Unheaded blocks keep the visual
    // result (a continuous sheet of photos) while leaving something for the
    // observer to mount and unmount. Album and trash views take this path too,
    // and previously rendered ungrouped in a single section for the same
    // reason, so they gain the windowing as well.
    const groups: AssetGroup[] = [];
    for (let i = 0; i < assets.length; i += UNGROUPED_BLOCK) {
      groups.push({ key: `block-${i}`, label: '', items: assets.slice(i, i + UNGROUPED_BLOCK) });
    }
    return groups;
  }

  const width = grouping === 'year' ? 4 : grouping === 'month' ? 7 : 10;
  const map = new Map<string, Asset[]>();
  for (const asset of assets) {
    const day = asset.taken_day ?? asset.created_at.slice(0, 10);
    const key = day.slice(0, width);
    const current = map.get(key);
    if (current) current.push(asset);
    else map.set(key, [asset]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: labelGroup(key, grouping),
    items
  }));
}
