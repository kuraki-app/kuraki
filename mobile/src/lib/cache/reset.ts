import { getDB } from '@/lib/cache/db';

/**
 * resetMirror empties every cached table, including the delta-sync cursor.
 *
 * The mirror is keyed by nothing. Its tables hold whichever library the app was
 * last pointed at, and `sync_meta.cursor` is a position in *that* server's
 * change_log. Point the app somewhere else and both become actively wrong:
 * the grid keeps serving the previous library's photos whenever a request
 * fails, and — worse — `syncChanges` asks the new server for everything since a
 * cursor that came from the old one. A server whose change_log has not reached
 * that number answers with nothing, so the app concludes it is up to date and
 * settles permanently on another library's contents while reporting
 * "Connected".
 *
 * `pending_mutations` goes too. Those are favourites and trashes queued against
 * asset ids that exist on the server they were made against; replaying them at
 * a different library is at best a string of 404s.
 */
export async function resetMirror(): Promise<void> {
  const db = await getDB();
  // One transaction: a partial wipe would leave, say, albums pointing at assets
  // that no longer exist, which reads as corruption rather than an empty cache.
  await db.execAsync(`
    BEGIN;
    DELETE FROM assets;
    DELETE FROM albums;
    DELETE FROM album_assets;
    DELETE FROM tags;
    DELETE FROM sync_meta;
    DELETE FROM pending_mutations;
    COMMIT;
  `);
}
