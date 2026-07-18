import type { LibraryAsset } from '@/lib/library-api';
import { getDB } from '@/lib/cache/db';
import { rowToAsset, upsertAssets } from '@/lib/cache/assets';

export type CachedAlbum = { id: string; name: string; cover_asset_id: string | null; count: number };

export async function upsertAlbums(albums: CachedAlbum[]): Promise<void> {
  if (!albums.length) return;
  const db = await getDB();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const a of albums) {
      await db.runAsync(
        `INSERT INTO albums (id, name, cover_asset_id, count, cached_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, cover_asset_id=excluded.cover_asset_id,
           count=excluded.count, cached_at=excluded.cached_at`,
        [a.id, a.name, a.cover_asset_id, a.count, now],
      );
    }
  });
}

export async function readAlbums(): Promise<CachedAlbum[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM albums ORDER BY name ASC`);
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    cover_asset_id: (r.cover_asset_id as string) ?? null,
    count: r.count as number,
  }));
}

export async function setAlbumAssets(albumId: string, assets: LibraryAsset[]): Promise<void> {
  // Mirror the assets themselves first (own transaction) so thumbnails resolve
  // offline, then replace the membership rows in a second transaction — nesting
  // withTransactionAsync calls on the same connection isn't supported.
  await upsertAssets(assets);
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM album_assets WHERE album_id = ?`, [albumId]);
    for (const a of assets) {
      await db.runAsync(
        `INSERT INTO album_assets (album_id, asset_id) VALUES (?, ?)
         ON CONFLICT(album_id, asset_id) DO NOTHING`,
        [albumId, a.id],
      );
    }
  });
}

export async function readAlbumAssets(albumId: string): Promise<LibraryAsset[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT assets.* FROM album_assets
     JOIN assets ON assets.id = album_assets.asset_id
     WHERE album_assets.album_id = ?
     ORDER BY assets.taken_at DESC`,
    [albumId],
  );
  return rows.map(rowToAsset);
}

export async function setTrashed(id: string, trashed: boolean): Promise<void> {
  const db = await getDB();
  await db.runAsync(`UPDATE assets SET trashed = ? WHERE id = ?`, [trashed ? 1 : 0, id]);
}

export async function readTrashed(): Promise<LibraryAsset[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM assets WHERE trashed = 1 ORDER BY taken_at DESC`);
  return rows.map(rowToAsset);
}

// deleteCachedAsset removes an asset from the local mirror entirely (used after a permanent purge).
export async function deleteCachedAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.runAsync('DELETE FROM album_assets WHERE asset_id = ?', [id]);
  await db.runAsync('DELETE FROM assets WHERE id = ?', [id]);
}
