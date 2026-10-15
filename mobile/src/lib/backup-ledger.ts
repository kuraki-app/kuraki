import * as SQLite from 'expo-sqlite';

export type OriginalProof = {
  asset_id: string;
  content_hash: string;
  size_bytes: number;
};
export type BackupReceipt = {
  localVersion: string;
  originals: OriginalProof[];
};
export type ResumableUpload = {
  sessionId: string;
  sizeBytes: number;
  offsetBytes: number;
};
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
async function getLedger(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('kuraki-backup.db');
      await db.execAsync(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS backed_up(local_id TEXT PRIMARY KEY,at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS backup_receipts_v2(
          library_key TEXT NOT NULL,local_id TEXT NOT NULL,receipt_json TEXT NOT NULL,at TEXT NOT NULL,
          PRIMARY KEY(library_key,local_id));
        CREATE TABLE IF NOT EXISTS capture_sessions_v2(
          library_key TEXT NOT NULL,local_id TEXT NOT NULL,local_version TEXT NOT NULL,
          session_id TEXT NOT NULL,size_bytes INTEGER NOT NULL,offset_bytes INTEGER NOT NULL,at TEXT NOT NULL,
          PRIMARY KEY(library_key,local_id));
      `);
      return db;
    })();
    void dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}
export function validProof(value: unknown): value is OriginalProof {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<OriginalProof>;
  return (
    typeof p.asset_id === 'string' &&
    p.asset_id.length > 0 &&
    typeof p.content_hash === 'string' &&
    /^[0-9a-f]{64}$/.test(p.content_hash) &&
    typeof p.size_bytes === 'number' &&
    Number.isSafeInteger(p.size_bytes) &&
    p.size_bytes > 0
  );
}
export async function loadBackupReceipts(
  library: string,
  ids?: string[],
): Promise<Map<string, BackupReceipt>> {
  const db = await getLedger();
  if (ids && (!ids.length || ids.length > 512)) return new Map();
  const sql =
    'SELECT local_id,receipt_json FROM backup_receipts_v2 WHERE library_key=?' +
    (ids ? ` AND local_id IN (${ids.map(() => '?').join(',')})` : '');
  const rows = await db.getAllAsync<{ local_id: string; receipt_json: string }>(
    sql,
    library,
    ...(ids ?? []),
  );
  const receipts = new Map<string, BackupReceipt>();
  for (const row of rows) {
    try {
      const r = JSON.parse(row.receipt_json) as Partial<BackupReceipt>;
      if (
        typeof r.localVersion === 'string' &&
        Array.isArray(r.originals) &&
        r.originals.length > 0 &&
        r.originals.every(validProof)
      )
        receipts.set(row.local_id, r as BackupReceipt);
    } catch {
      /* Corrupt/unverified data never authorizes reclamation. */
    }
  }
  return receipts;
}
export async function loadBackedUpIds(library?: string): Promise<Set<string>> {
  if (!library) return new Set();
  return new Set((await loadBackupReceipts(library)).keys());
}
export async function markBackedUp(
  localId: string,
  library: string,
  receipt: BackupReceipt,
): Promise<void> {
  if (!receipt.originals.length || !receipt.originals.every(validProof))
    throw new Error('Backup requires a verified original receipt.');
  const db = await getLedger();
  await db.runAsync(
    'INSERT OR REPLACE INTO backup_receipts_v2(library_key,local_id,receipt_json,at) VALUES(?,?,?,?)',
    library,
    localId,
    JSON.stringify(receipt),
    new Date().toISOString(),
  );
}
// Preserve legacy records for recovery; they have no trustworthy library or
// content identity and are never migrated into verified deletion permission.
export async function importLegacyDoneIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getLedger();
  await db.withTransactionAsync(async () => {
    for (const id of ids)
      await db.runAsync(
        'INSERT OR IGNORE INTO backed_up(local_id,at) VALUES(?,?)',
        id,
        new Date().toISOString(),
      );
  });
}
export async function loadResumableUpload(
  localId: string,
  library: string,
  version: string,
): Promise<ResumableUpload | null> {
  const db = await getLedger();
  const row = await db.getFirstAsync<{
    session_id: string;
    size_bytes: number;
    offset_bytes: number;
  }>(
    'SELECT session_id,size_bytes,offset_bytes FROM capture_sessions_v2 WHERE library_key=? AND local_id=? AND local_version=?',
    library,
    localId,
    version,
  );
  return row
    ? {
        sessionId: row.session_id,
        sizeBytes: row.size_bytes,
        offsetBytes: row.offset_bytes,
      }
    : null;
}
export async function saveResumableUpload(
  localId: string,
  upload: ResumableUpload,
  library: string,
  version: string,
): Promise<void> {
  const db = await getLedger();
  await db.runAsync(
    `INSERT OR REPLACE INTO capture_sessions_v2(library_key,local_id,local_version,session_id,size_bytes,offset_bytes,at) VALUES(?,?,?,?,?,?,?)`,
    library,
    localId,
    version,
    upload.sessionId,
    upload.sizeBytes,
    upload.offsetBytes,
    new Date().toISOString(),
  );
}
export async function clearResumableUpload(
  localId: string,
  library: string,
): Promise<void> {
  const db = await getLedger();
  await db.runAsync(
    'DELETE FROM capture_sessions_v2 WHERE library_key=? AND local_id=?',
    library,
    localId,
  );
}
export function canResume(
  stored: ResumableUpload | null,
  size: number,
): boolean {
  return (
    !!stored &&
    stored.sizeBytes === size &&
    Number.isSafeInteger(stored.offsetBytes) &&
    stored.offsetBytes >= 0 &&
    stored.offsetBytes <= size
  );
}

export async function backedUpCount(library: string): Promise<number> {
  const db = await getLedger();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM backup_receipts_v2 WHERE library_key=?',
    library,
  );
  return row?.count ?? 0;
}

export async function forgetReceipt(
  scope: string,
  localID: string,
): Promise<void> {
  const db = await getLedger();
  await db.runAsync(
    'DELETE FROM backup_receipts_v2 WHERE library_key=? AND local_id=?',
    scope,
    localID,
  );
}
