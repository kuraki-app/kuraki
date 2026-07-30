import * as SQLite from 'expo-sqlite';

/**
 * The ledger of local assets this device has already handed to the server.
 *
 * Deliberately a SEPARATE database file from the `kuraki.db` read cache. That
 * cache documents itself as disposable ("dropping the file is acceptable"),
 * which is true of mirrored server data and emphatically not true of this:
 * losing it re-enqueues the entire camera roll for upload. Server-side
 * content-hash dedup would stop duplicate assets appearing, but every byte
 * would still cross the network.
 *
 * It also replaces a JSON array in AsyncStorage. That array was rewritten in
 * full on every successful item, and on Android AsyncStorage caps its database
 * at 6 MB with a 2 MB ceiling on a single row -- so a large library eventually
 * made the backup state unreadable, and the read sat outside the caller's
 * try/catch. A row per asset removes both the write amplification and the cap.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getLedger(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('kuraki-backup.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS backed_up (
          local_id TEXT PRIMARY KEY,
          at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS upload_sessions (
          local_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          offset_bytes INTEGER NOT NULL DEFAULT 0,
          at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** loadBackedUpIds returns every local asset id already accepted by the server. */
export async function loadBackedUpIds(): Promise<Set<string>> {
  const db = await getLedger();
  const rows = await db.getAllAsync<{ local_id: string }>('SELECT local_id FROM backed_up');
  return new Set(rows.map((r) => r.local_id));
}

/** markBackedUp records one asset. One row, not a rewrite of the whole set. */
export async function markBackedUp(localId: string): Promise<void> {
  const db = await getLedger();
  await db.runAsync('INSERT OR REPLACE INTO backed_up (local_id, at) VALUES (?, ?)', localId, new Date().toISOString());
}

/** importLegacyDoneIds seeds the ledger from the pre-SQLite AsyncStorage array. */
export async function importLegacyDoneIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getLedger();
  const at = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('INSERT OR IGNORE INTO backed_up (local_id, at) VALUES (?, ?)', id, at);
    }
  });
}

export type ResumableUpload = {
  sessionId: string;
  sizeBytes: number;
  offsetBytes: number;
};

/**
 * loadResumableUpload returns a previously-started session for this asset, so
 * an interrupted multi-gigabyte upload continues from the server's offset
 * instead of byte 0. `sizeBytes` is checked by the caller: if the file changed,
 * the old session describes different bytes and must not be reused.
 */
export async function loadResumableUpload(localId: string): Promise<ResumableUpload | null> {
  const db = await getLedger();
  const row = await db.getFirstAsync<{ session_id: string; size_bytes: number; offset_bytes: number }>(
    'SELECT session_id, size_bytes, offset_bytes FROM upload_sessions WHERE local_id = ?',
    localId,
  );
  if (!row) return null;
  return { sessionId: row.session_id, sizeBytes: row.size_bytes, offsetBytes: row.offset_bytes };
}

export async function saveResumableUpload(localId: string, upload: ResumableUpload): Promise<void> {
  const db = await getLedger();
  await db.runAsync(
    `INSERT INTO upload_sessions (local_id, session_id, size_bytes, offset_bytes, at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_id) DO UPDATE SET
       session_id = excluded.session_id,
       size_bytes = excluded.size_bytes,
       offset_bytes = excluded.offset_bytes,
       at = excluded.at`,
    localId,
    upload.sessionId,
    upload.sizeBytes,
    upload.offsetBytes,
    new Date().toISOString(),
  );
}

export async function clearResumableUpload(localId: string): Promise<void> {
  const db = await getLedger();
  await db.runAsync('DELETE FROM upload_sessions WHERE local_id = ?', localId);
}

/**
 * canResume decides whether a stored session still describes the file in hand.
 * Pure, so the rule is testable without a database or a device.
 */
export function canResume(stored: ResumableUpload | null, currentSize: number): boolean {
  if (!stored) return false;
  // A different size means different bytes: the asset was edited or replaced
  // and the server's partial upload belongs to something else.
  if (stored.sizeBytes !== currentSize) return false;
  // A complete or over-long stored offset is nonsense; start clean.
  if (stored.offsetBytes <= 0 || stored.offsetBytes >= currentSize) return false;
  return true;
}
