import type { LibraryAsset } from '@/lib/library-api';

/**
 * A memories rail entry: one year's worth of "on this day", with the newest
 * asset in that year standing as its cover.
 */
export type MemoryGroup = {
  /** Stable list key. The four-digit year. */
  key: string;
  /** Relative label — "Last year", "5 years ago". */
  title: string;
  /** The absolute year, so the relative label is never the only anchor. */
  subtitle: string;
  /** Newest asset in the group, drawn as the card. */
  cover: LibraryAsset;
  /** How many assets the year contributed. */
  count: number;
};

/**
 * memoryGroups turns a flat "on this day" page into the cards the rail draws.
 *
 * The server returns assets from this calendar day across every year, newest
 * first. That is the right shape for a grid and the wrong shape for a rail:
 * four thumbnails from the same afternoon in 2019 are one memory, not four.
 * Grouping by year is what makes each card mean something distinct.
 *
 * Ordering is newest year first, matching the feed it came from — the most
 * recent memory is the one most likely to be recognised, so it earns the
 * leftmost card.
 *
 * Assets with no `taken_at` are dropped rather than bucketed under a fallback
 * year: an undated photo is not a memory of any particular day, and putting it
 * under the current year would assert something the data does not say.
 *
 * **The current year is dropped too.** The feed is "this calendar day across
 * every year", which for the current year is simply today — and today's photos
 * are already the first thing in the timeline directly beneath the rail. On
 * device that rendered the same photograph twice, once as a card captioned
 * "Earlier this year" and once as the first grid tile. A memory of today is not
 * a memory. Future-dated assets (a camera with a wrong clock, which is common)
 * fall out of the same check rather than rendering "-3 years ago".
 *
 * `now` is injected so the relative labels are testable and so a rail rendered
 * either side of midnight cannot disagree with itself mid-scroll.
 */
export function memoryGroups(assets: LibraryAsset[], now: Date = new Date()): MemoryGroup[] {
  const thisYear = now.getFullYear();
  const byYear = new Map<number, { cover: LibraryAsset; count: number }>();

  for (const asset of assets) {
    if (!asset.taken_at) continue;
    const year = new Date(asset.taken_at).getFullYear();
    if (!Number.isFinite(year)) continue;

    const seen = byYear.get(year);
    // Assets arrive newest first, so the first one seen for a year is its
    // newest — later ones only add to the count.
    if (seen) seen.count += 1;
    else byYear.set(year, { cover: asset, count: 1 });
  }

  return [...byYear.entries()]
    .filter(([year]) => thisYear - year >= 1)
    .sort((a, b) => b[0] - a[0])
    .map(([year, { cover, count }]) => ({
      key: String(year),
      title: relativeYear(thisYear - year),
      subtitle: String(year),
      cover,
      count,
    }));
}

/**
 * relativeYear names a distance in years the way a person would say it.
 *
 * "Last year" rather than "1 years ago" — the arithmetic form is the one that
 * makes an app sound like a database. Only ever called with a distance of 1 or
 * more, because `memoryGroups` filters the rest out before mapping.
 *
 * Kept short on purpose: this is the title line of a 108pt-wide card at 13pt,
 * and "Earlier this year" (the old zero-distance label) truncated to "Earlier
 * this..." on device.
 */
function relativeYear(distance: number): string {
  return distance === 1 ? 'Last year' : `${distance} years ago`;
}
