import type { Tag } from '@/lib/library-api';

// upsertTags replaces the cached tag list wholesale — the list is small and the
// server is the source of truth, so a full swap avoids stale/orphaned rows.
export async function upsertTags(tags: Tag[]): Promise<void> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM tags');
    for (const t of tags) {
      await db.runAsync(
        `INSERT OR REPLACE INTO tags (id, name, parent_id, cached_at) VALUES (?, ?, ?, ?)`,
        [t.id, t.name, t.parent_id ?? null, now],
      );
    }
  });
}

export async function readTags(): Promise<Tag[]> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  const rows = await db.getAllAsync<{ id: string; name: string; parent_id: string | null }>(
    `SELECT id, name, parent_id FROM tags ORDER BY name`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, parent_id: r.parent_id ?? undefined }));
}
