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
      if (v < 3) {
        // v3: a tiny kv table for the delta-sync cursor. Same all-or-nothing
        // transaction discipline as v2. If the cache file is ever dropped the
        // cursor resets to 0, which replays the feed from the start — harmless
        // because create/update apply as idempotent upserts and the mirror is
        // empty anyway, so it just rebuilds.
        await db.execAsync(`
          BEGIN;
          CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
          );
          PRAGMA user_version = 3;
          COMMIT;
        `);
      }
      if (v < 4) {
        // v4: a cached tag list so browse-by-tag renders offline (the grid
        // itself still needs the network, like Places). Same all-or-nothing
        // discipline as v2/v3.
        await db.execAsync(`
          BEGIN;
          CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, cached_at TEXT NOT NULL
          );
          PRAGMA user_version = 4;
          COMMIT;
        `);
      }
      if (v < 5) {
        // v5: taken_day. The mirror only ever stored taken_at, so a grid seeded
        // from this cache had no calendar day to group by and every photo fell
        // into "Undated". taken_at is a UTC instant; taken_day is the local day
        // the photo was taken, which is what the date headings must use — see
        // groupLabel in lib/gallery.ts. Same all-or-nothing discipline as above.
        await db.execAsync(`
          BEGIN;
          ALTER TABLE assets ADD COLUMN taken_day TEXT;
          PRAGMA user_version = 5;
          COMMIT;
        `);
      }
      if (v < 6) {
        // v6: size_bytes, for the grid's size badge. Same reason as taken_day:
        // a value the mirror does not store is a value the offline grid cannot
        // show.
        await db.execAsync(`
          BEGIN;
          ALTER TABLE assets ADD COLUMN size_bytes INTEGER;
          PRAGMA user_version = 6;
          COMMIT;
        `);
      }
      if (v < 7) {
        // v7: the album cover's asset ids, for the 2x2 mosaic. Stored as a JSON
        // array in one column rather than a join table — it is a fixed, tiny
        // list that is always read and written whole, so a second table would
        // buy nothing. The old single-cover column stays: dropping a column in
        // SQLite means rebuilding the table, and a disused column in a cache
        // that can be deleted wholesale is not worth that.
        await db.execAsync(`
          BEGIN;
          ALTER TABLE albums ADD COLUMN cover_asset_ids TEXT;
          PRAGMA user_version = 7;
          COMMIT;
        `);
      }
      return db;
    })();
  }
  return dbPromise;
}
