import type { LibraryAsset } from '@/lib/library-api';

// The three things the Gallery can show. These used to be a row of segment
// buttons across the top; they are now entries in the header's native menu, so
// the grid keeps the width the buttons were taking.
export type GalleryView = 'timeline' | 'memories' | 'places' | 'archived';

// Archived is here rather than in Settings because it is a *view of photos*,
// and because archiving from the selection header would otherwise make photos
// vanish with nowhere to find them again. The server has filtered on `archived`
// since the organization migration; only the client was missing.
export const GALLERY_VIEWS: { key: GalleryView; label: string }[] = [
  { key: 'timeline', label: 'Photos' },
  { key: 'memories', label: 'On this day' },
  { key: 'places', label: 'Places' },
  { key: 'archived', label: 'Archived' },
];

/** The header title, which always names the view currently on screen. */
export function galleryTitle(view: GalleryView): string {
  return GALLERY_VIEWS.find((v) => v.key === view)?.label ?? 'Photos';
}

export type GroupBy = 'month' | 'year' | 'off';

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'off', label: 'Off' },
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const UNDATED = 'Undated';

/**
 * groupLabel turns an ISO date into a section heading.
 *
 * The date is read as calendar parts rather than through `new Date()`, because
 * `new Date('2026-08-01')` is parsed as UTC midnight and then rendered in local
 * time — which puts the first of any month into the previous month for every
 * timezone west of Greenwich. `taken_day` is already the local calendar day the
 * photo was taken, so it must not be converted again.
 */
export function groupLabel(iso: string, groupBy: GroupBy): string {
  const [y, m] = iso.split('-');
  if (groupBy === 'year') return y;
  const month = MONTHS[Number(m) - 1];
  return month ? `${month} ${y}` : y;
}

/** One row of the grid: up to `columns` assets. */
export type PhotoRow = LibraryAsset[];

export type PhotoSection = { key: string; title: string; data: PhotoRow[] };

function bucketOf(asset: LibraryAsset, groupBy: GroupBy): string {
  if (groupBy === 'off') return '';
  const day = asset.taken_day ?? asset.taken_at?.slice(0, 10);
  return day ? groupLabel(day, groupBy) : UNDATED;
}

function chunk(assets: LibraryAsset[], columns: number): PhotoRow[] {
  const rows: PhotoRow[] = [];
  for (let i = 0; i < assets.length; i += columns) rows.push(assets.slice(i, i + columns));
  return rows;
}

/**
 * groupAssets turns a flat, already date-sorted asset list into the sections a
 * SectionList renders. Rows are chunked *within* a section, never across one,
 * so a heading can never land in the middle of a row of tiles.
 *
 * Order is preserved exactly as the server returned it; this only inserts
 * boundaries, it never sorts.
 */
export function groupAssets(
  assets: LibraryAsset[],
  groupBy: GroupBy,
  columns: number,
): PhotoSection[] {
  if (assets.length === 0) return [];

  const sections: PhotoSection[] = [];
  let current: LibraryAsset[] = [];
  let title: string | null = null;

  const flush = () => {
    if (title === null) return;
    sections.push({ key: `${sections.length}:${title}`, title, data: chunk(current, columns) });
    current = [];
  };

  for (const asset of assets) {
    const bucket = bucketOf(asset, groupBy);
    if (title === null) title = bucket;
    else if (bucket !== title) {
      flush();
      title = bucket;
    }
    current.push(asset);
  }
  flush();

  return sections;
}
