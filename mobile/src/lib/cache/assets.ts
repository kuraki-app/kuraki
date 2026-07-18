import type { LibraryAsset } from '@/lib/library-api';
import { getDB } from '@/lib/cache/db';

export async function upsertAssets(assets: LibraryAsset[]): Promise<void> {
  if (!assets.length) return;
  const db = await getDB();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const a of assets) {
      await db.runAsync(
        `INSERT INTO assets (id, filename, media_type, taken_at, favorite, thumbnail_url, preview_url, web_viewable, place_city, place_country, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           filename=excluded.filename, media_type=excluded.media_type, taken_at=excluded.taken_at,
           favorite=excluded.favorite, thumbnail_url=excluded.thumbnail_url, preview_url=excluded.preview_url,
           web_viewable=excluded.web_viewable, place_city=excluded.place_city, place_country=excluded.place_country,
           cached_at=excluded.cached_at`,
        [a.id, a.filename, a.media_type, a.taken_at ?? null, a.favorite ? 1 : 0,
         a.thumbnail_url ?? null, a.preview_url ?? null, a.web_viewable ? 1 : 0,
         a.place_city ?? null, a.place_country ?? null, now],
      );
    }
  });
}

// Shared row -> LibraryAsset mapping, reused by albums.ts so the cache mirror
// (and its nullable/optional shape) has exactly one source of truth.
export function rowToAsset(r: Record<string, unknown>): LibraryAsset {
  return {
    id: r.id as string,
    filename: r.filename as string,
    media_type: r.media_type as string,
    taken_at: (r.taken_at as string) ?? undefined,
    favorite: !!r.favorite,
    thumbnail_url: (r.thumbnail_url as string) ?? null,
    preview_url: (r.preview_url as string) ?? null,
    web_viewable: !!r.web_viewable,
    place_city: (r.place_city as string) ?? undefined,
    place_country: (r.place_country as string) ?? undefined,
  };
}

type CacheFilter = { type?: string; favorite?: boolean; q?: string; limit?: number };

export async function readAssets(filter: CacheFilter): Promise<LibraryAsset[]> {
  const db = await getDB();
  // Trashed rows stay in the mirror (Trash's offline fallback reads them via
  // readTrashed), but the Timeline's offline fallback must never resurrect
  // them — always exclude, regardless of the caller's other filters.
  const where: string[] = ['IFNULL(trashed,0) = 0'];
  const args: (string | number)[] = [];
  if (filter.type) { where.push('media_type = ?'); args.push(filter.type); }
  if (filter.favorite) { where.push('favorite = 1'); }
  if (filter.q) { where.push('filename LIKE ?'); args.push(`%${filter.q}%`); }
  const clause = `WHERE ${where.join(' AND ')}`;
  args.push(filter.limit ?? 200);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM assets ${clause} ORDER BY taken_at DESC LIMIT ?`, args);
  return rows.map(rowToAsset);
}

export async function setCachedFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await getDB();
  await db.runAsync(`UPDATE assets SET favorite = ? WHERE id = ?`, [favorite ? 1 : 0, id]);
}
