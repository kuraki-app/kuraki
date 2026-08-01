import type { LibraryFilters } from '@/lib/library-api';

// The chip row that used to sit above the Gallery grid. It lives here rather
// than in the screen so the chip -> filter mapping can be tested without a
// renderer, and so Gallery and Search cannot drift apart.
export const SEARCH_CHIPS: { label: string; filter: LibraryFilters }[] = [
  { label: 'All', filter: {} },
  { label: 'Photos', filter: { type: 'image' } },
  { label: 'Videos', filter: { type: 'video' } },
  { label: 'Favorites', filter: { favorite: true } },
];

/**
 * searchFilters combines the selected chip with the typed query into the one
 * filter shape the server understands. An out-of-range index falls back to
 * "All" rather than throwing — the index comes from component state that can
 * outlive a change to the chip list.
 */
export function searchFilters(chipIndex: number, query: string): LibraryFilters {
  const chip = SEARCH_CHIPS[chipIndex] ?? SEARCH_CHIPS[0];
  const q = query.trim();
  return { ...chip.filter, ...(q ? { q } : {}) };
}
