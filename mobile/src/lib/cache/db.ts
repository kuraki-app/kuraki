import * as SQLite from 'expo-sqlite';

// One connection for the app. The schema is created idempotently on first open;
// there is no migration framework here because this is a disposable read cache —
// if the shape ever changes incompatibly, dropping the file is acceptable.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('kuraki.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          filename TEXT,
          media_type TEXT,
          taken_at TEXT,
          favorite INTEGER NOT NULL DEFAULT 0,
          thumbnail_url TEXT,
          preview_url TEXT,
          web_viewable INTEGER NOT NULL DEFAULT 0,
          place_city TEXT,
          place_country TEXT,
          cached_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_assets_taken ON assets(taken_at DESC);
        CREATE TABLE IF NOT EXISTS pending_mutations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0
        );
      `);
      const { user_version: v } = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')) ?? { user_version: 0 };
      if (v < 2) {
        // Wrapped in an explicit transaction so this migration is all-or-nothing:
        // ALTER TABLE and PRAGMA user_version are both transactional in SQLite,
        // so a process death mid-migration rolls back cleanly and re-runs the
        // whole block next launch instead of re-running just the ALTER (which
        // would crash on "duplicate column" against the bricked cache).
        await db.execAsync(`
          BEGIN;
          ALTER TABLE assets ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0;
          CREATE TABLE IF NOT EXISTS albums (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            cover_asset_id TEXT, count INTEGER NOT NULL DEFAULT 0, cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS album_assets (
            album_id TEXT NOT NULL, asset_id TEXT NOT NULL,
            PRIMARY KEY (album_id, asset_id)
          );
          PRAGMA user_version = 2;
          COMMIT;
        `);
      }
      return db;
    })();
  }
  return dbPromise;
}
