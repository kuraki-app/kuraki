export type MutationOutcome = 'sent' | 'drop' | 'retry';
export type PendingMutation = { id: number; asset_id: string; kind: string; payload: string; attempts: number };

// classifyMutationResult decides a queued write's fate from the server reply.
// 401 is retried — auth is lost, not the mutation's fault, and the queue
// drains after re-pair. Any other 4xx (404 gone, 409 already-trashed/
// not-in-trash conflict, 400 bad request, ...) can never succeed by retrying
// as-is, so it's dropped rather than wedging the FIFO queue behind it forever.
// 5xx / unknown / network errors are worth another attempt.
export function classifyMutationResult(status: number, networkError: boolean): MutationOutcome {
  if (networkError) return 'retry';
  if (status >= 200 && status < 300) return 'sent';
  if (status === 401) return 'retry';
  if (status >= 400 && status < 500) return 'drop';
  return 'retry';
}

export async function clearMutations(): Promise<void> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync('DELETE FROM pending_mutations');
}

export async function enqueueFavorite(assetId: string, favorite: boolean): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'favorite', ?, ?)`,
    [assetId, JSON.stringify({ favorite }), new Date().toISOString()],
  );
}

export async function enqueueAlbumAdd(assetId: string, albumId: string): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'album_add', ?, ?)`,
    [assetId, JSON.stringify({ album_id: albumId }), new Date().toISOString()],
  );
}

export async function enqueueAlbumRemove(assetId: string, albumId: string): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'album_remove', ?, ?)`,
    [assetId, JSON.stringify({ album_id: albumId }), new Date().toISOString()],
  );
}

export async function enqueueSetTags(assetId: string, tagIDs: string[]): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'set_tags', ?, ?)`,
    [assetId, JSON.stringify({ tag_ids: tagIDs }), new Date().toISOString()],
  );
}

export async function enqueueTrash(assetId: string): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'trash', ?, ?)`,
    [assetId, JSON.stringify({}), new Date().toISOString()],
  );
}

export async function enqueueRestore(assetId: string): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'restore', ?, ?)`,
    [assetId, JSON.stringify({}), new Date().toISOString()],
  );
}

export async function enqueuePurge(assetId: string): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'purge', ?, ?)`,
    [assetId, JSON.stringify({}), new Date().toISOString()],
  );
}

// pendingFavorites returns the not-yet-flushed favorite intents keyed by asset,
// FIFO so the latest queued value wins. Screens overlay these on freshly-fetched
// pages so a stale server value can't visually revert an optimistic favorite
// before the queue drains.
export async function pendingFavorites(): Promise<Map<string, boolean>> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  const rows = await db.getAllAsync<{ asset_id: string; payload: string }>(
    `SELECT asset_id, payload FROM pending_mutations WHERE kind = 'favorite' ORDER BY id ASC`);
  const map = new Map<string, boolean>();
  for (const r of rows) {
    try { map.set(r.asset_id, (JSON.parse(r.payload) as { favorite: boolean }).favorite); } catch { /* skip */ }
  }
  return map;
}

// flushMutations sends queued writes FIFO. The caller supplies the transport so
// this module stays testable and free of fetch/settings coupling. A retry is
// left in place (attempts bumped) to be picked up on the next flush.
export async function flushMutations(
  send: (m: PendingMutation) => Promise<{ status: number; networkError: boolean }>,
): Promise<void> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  const rows = await db.getAllAsync<PendingMutation>(
    `SELECT id, asset_id, kind, payload, attempts FROM pending_mutations ORDER BY id ASC`);
  for (const m of rows) {
    const { status, networkError } = await send(m);
    const outcome = classifyMutationResult(status, networkError);
    if (outcome === 'retry') {
      await db.runAsync(`UPDATE pending_mutations SET attempts = attempts + 1 WHERE id = ?`, [m.id]);
      break; // preserve order: stop at the first unsent item
    }
    await db.runAsync(`DELETE FROM pending_mutations WHERE id = ?`, [m.id]);
  }
}
