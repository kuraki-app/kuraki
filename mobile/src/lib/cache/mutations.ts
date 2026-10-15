import { writeLibraryCache } from '@/lib/cache/writes';
import { orderedLibraryWork } from '@/lib/cache/operations';
import type { CaptureSettings } from '@/lib/settings';
export type MutationOutcome = 'sent' | 'drop' | 'retry';
export type PendingMutation = {
  id: number;
  asset_id: string;
  kind: string;
  payload: string;
  attempts: number;
};

// classifyMutationResult decides a queued write's fate from the server reply.
// 401, 408 and 429 are retried — auth is lost, not the mutation's fault, and the queue
// drains after re-pair or a temporary timeout/rate limit. Other 4xx (404 gone, 409 already-trashed/
// not-in-trash conflict, 400 bad request, ...) can never succeed by retrying
// as-is, so it's dropped rather than wedging the FIFO queue behind it forever.
// 5xx / unknown / network errors are worth another attempt.
export function classifyMutationResult(
  status: number,
  networkError: boolean,
): MutationOutcome {
  if (networkError) return 'retry';
  if (status >= 200 && status < 300) return 'sent';
  if (status === 401 || status === 408 || status === 429) return 'retry';
  if (status >= 400 && status < 500) return 'drop';
  return 'retry';
}

export async function clearMutations(): Promise<void> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  return writeLibraryCache(db, async () => {
    await db.runAsync('DELETE FROM pending_mutations');
  });
}

export async function enqueueFavorite(
  assetId: string,
  favorite: boolean,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'favorite', ?, ?)`,
      [assetId, JSON.stringify({ favorite }), new Date().toISOString()],
    );
  });
}

export async function enqueueAlbumAdd(
  assetId: string,
  albumId: string,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'album_add', ?, ?)`,
      [assetId, JSON.stringify({ album_id: albumId }), new Date().toISOString()],
    );
  });
}

export async function enqueueAlbumRemove(
  assetId: string,
  albumId: string,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'album_remove', ?, ?)`,
      [assetId, JSON.stringify({ album_id: albumId }), new Date().toISOString()],
    );
  });
}

export async function enqueueSetTags(
  assetId: string,
  tagIDs: string[],
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'set_tags', ?, ?)`,
      [assetId, JSON.stringify({ tag_ids: tagIDs }), new Date().toISOString()],
    );
  });
}

export async function enqueueTrash(
  assetId: string,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'trash', ?, ?)`,
      [assetId, JSON.stringify({}), new Date().toISOString()],
    );
  });
}

export async function enqueueRestore(
  assetId: string,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'restore', ?, ?)`,
      [assetId, JSON.stringify({}), new Date().toISOString()],
    );
  });
}

export async function enqueuePurge(
  assetId: string,
  settings?: CaptureSettings,
): Promise<void> {
  // Dynamic import keeps expo-sqlite (a native module) out of the Vitest node
  // environment when only the pure classifyMutationResult above is imported.
  // Do not change to a static top-level import — it breaks `npm run test`.
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    await db.runAsync(
      `INSERT INTO pending_mutations (asset_id, kind, payload, created_at) VALUES (?, 'purge', ?, ?)`,
      [assetId, JSON.stringify({}), new Date().toISOString()],
    );
  });
}

// pendingFavorites returns the not-yet-flushed favorite intents keyed by asset,
// FIFO so the latest queued value wins. Screens overlay these on freshly-fetched
// pages so a stale server value can't visually revert an optimistic favorite
// before the queue drains.
export async function pendingFavorites(): Promise<Map<string, boolean>> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB();
  const rows = await db.getAllAsync<{ asset_id: string; payload: string }>(
    `SELECT asset_id, payload FROM pending_mutations WHERE kind = 'favorite' ORDER BY id ASC`,
  );
  const map = new Map<string, boolean>();
  for (const r of rows) {
    try {
      map.set(
        r.asset_id,
        (JSON.parse(r.payload) as { favorite: boolean }).favorite,
      );
    } catch {
      /* skip */
    }
  }
  return map;
}

export async function enqueueMutation(
  assetID: string,
  kind: string,
  payload: Record<string, unknown>,
  settings: CaptureSettings,
): Promise<number> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return writeLibraryCache(db, async () => {
    const result = await db.runAsync(
      'INSERT INTO pending_mutations(asset_id,kind,payload,created_at) VALUES(?,?,?,?)',
      [assetID, kind, JSON.stringify(payload), new Date().toISOString()],
    );
    return Number(result.lastInsertRowId);
  });
}

// flushMutations sends queued writes FIFO. The caller supplies the transport so
// this module stays testable and free of fetch/settings coupling. A retry is
// left in place (attempts bumped) to be picked up on the next flush.
export async function flushMutations(
  send: (
    m: PendingMutation,
  ) => Promise<{ status: number; networkError: boolean; message?: string }>,
  settings?: CaptureSettings,
  signal?: AbortSignal,
): Promise<void> {
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return orderedLibraryWork(
    db,
    async () => {
      // Results need only outlive bounded foreground calls, not the library.
      await writeLibraryCache(db, () => db.runAsync('DELETE FROM mutation_rejections WHERE created_at < ?', [
        new Date(Date.now() - 86400000).toISOString(),
      ]));
      for (let page = 0; page < 5; page++) {
        const rows = await db.getAllAsync<PendingMutation>(
          `SELECT id, asset_id, kind, payload, attempts FROM pending_mutations ORDER BY id ASC LIMIT 100`,
        );
        for (const m of rows) {
          if (signal?.aborted)
            throw Object.assign(new Error('Sync canceled.'), {
              name: 'AbortError',
            });
          const { status, networkError, message } = await send(m);
          if (signal?.aborted)
            throw Object.assign(new Error('Sync canceled.'), {
              name: 'AbortError',
            });
          const outcome = classifyMutationResult(status, networkError);
          if (outcome === 'retry') {
            await writeLibraryCache(db, () => db.runAsync(
              `UPDATE pending_mutations SET attempts = attempts + 1 WHERE id = ?`,
              [m.id],
            ));
            return; // preserve order: stop at the first unsent item
          }
          await writeLibraryCache(db, () => db.withTransactionAsync(async () => {
            if (outcome === 'drop')
              await db.runAsync(
                'INSERT OR REPLACE INTO mutation_rejections(id,status,message,created_at) VALUES(?,?,?,?)',
                [m.id, status, message ?? `Change rejected (${status}).`, new Date().toISOString()],
              );
            await db.runAsync('DELETE FROM pending_mutations WHERE id = ?', [m.id]);
          }));
        }
        if (rows.length < 100) return;
      }
    },
    signal,
  );
}

/** A queued deletion is already known to invalidate this future backup copy. */
export async function assertNoPendingRemoval(
  settings: CaptureSettings,
  assetIDs: string[],
): Promise<void> {
  if (!assetIDs.length) return;
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  const row = await db.getFirstAsync(
    `SELECT id FROM pending_mutations WHERE kind IN ('trash','purge') AND asset_id IN (${assetIDs.map(() => '?').join(',')}) LIMIT 1`,
    assetIDs,
  );
  if (row)
    throw new Error(
      'This original has a pending server deletion. Finish library changes before removing its local copy.',
    );
}

/** Read a live intent's terminal outcome even if another drain processed it. */
export async function intentRejection(settings: CaptureSettings, ids: number[]) {
  if (!ids.length) return null;
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  for (const id of ids) {
    const rejected = await db.getFirstAsync<{ status: number; message: string }>(
      'SELECT status,message FROM mutation_rejections WHERE id = ?', [id],
    );
    if (rejected) return rejected;
  }
  return null;
}
