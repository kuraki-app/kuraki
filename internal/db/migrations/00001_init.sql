-- +goose Up
-- +goose StatementBegin

-- Single owner in Phase 1; owner_id is carried on assets from day one so
-- multi-user (F-30) becomes a data migration rather than a schema rewrite.
CREATE TABLE users (
    id            TEXT PRIMARY KEY,           -- UUIDv7
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,              -- argon2id
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Imported photos and videos. Originals are write-once (F-03).
CREATE TABLE assets (
    id            TEXT PRIMARY KEY,           -- UUIDv7
    owner_id      TEXT NOT NULL REFERENCES users(id),
    content_hash  TEXT NOT NULL,              -- BLAKE3 hex; dedup key (F-05)
    original_path TEXT NOT NULL,              -- relative to originals root, e.g. 2026/07/IMG_1234.jpg
    filename      TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    media_type    TEXT NOT NULL CHECK (media_type IN ('image','video')),
    width         INTEGER NOT NULL DEFAULT 0,
    height        INTEGER NOT NULL DEFAULT 0,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    taken_at      TEXT,                       -- EXIF capture time (nullable)
    camera_make   TEXT NOT NULL DEFAULT '',
    camera_model  TEXT NOT NULL DEFAULT '',
    gps_lat       REAL,
    gps_lon       REAL,
    duration_ms   INTEGER NOT NULL DEFAULT 0, -- videos only
    favorite      INTEGER NOT NULL DEFAULT 0,
    embedding     BLOB,                       -- reserved for ML (F-32); NULL in Phase 1
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at    TEXT                        -- soft delete -> trash (F-10)
);
-- Dedup: identical bytes stored once per owner (F-05).
CREATE UNIQUE INDEX ux_assets_owner_hash ON assets(owner_id, content_hash);
-- Timeline ordering (F-06) and trash queries (F-10).
CREATE INDEX ix_assets_owner_taken ON assets(owner_id, taken_at);
CREATE INDEX ix_assets_owner_deleted ON assets(owner_id, deleted_at);

-- Generated thumbnails/previews/posters (F-07). One original -> many derivatives.
CREATE TABLE derivatives (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind     TEXT NOT NULL CHECK (kind IN ('thumb','preview','poster')),
    format   TEXT NOT NULL,                   -- 'webp' (vips) or 'jpeg' (purego)
    path     TEXT NOT NULL,                   -- relative to derivatives root
    width    INTEGER NOT NULL DEFAULT 0,
    height   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (asset_id, kind)
);

-- Albums: schema ships in v1.0; UI is a P1 fast-follow (F-21).
CREATE TABLE albums (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT
);
CREATE TABLE album_assets (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, asset_id)
);

-- Login sessions (F-14). Cookie carries the session id.
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,              -- opaque random token
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX ix_sessions_expires ON sessions(expires_at);

-- Resume support for CLI bulk import (F-04). Keyed by source path; size+mtime
-- let a re-run skip unchanged files that already completed.
CREATE TABLE import_state (
    source_path  TEXT PRIMARY KEY,
    size         INTEGER NOT NULL,
    mtime        TEXT NOT NULL,
    content_hash TEXT,
    status       TEXT NOT NULL CHECK (status IN ('pending','done','skipped','error')),
    error        TEXT NOT NULL DEFAULT '',
    imported_at  TEXT
);

-- Change log for future device sync (F-33). Append-only.
CREATE TABLE change_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entity     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    op         TEXT NOT NULL CHECK (op IN ('create','update','delete')),
    changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Non-ML full-text search (F-09). App-populated on import/update.
CREATE VIRTUAL TABLE assets_fts USING fts5(
    asset_id UNINDEXED,
    filename,
    camera_model,
    taken_text
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS assets_fts;
DROP TABLE IF EXISTS change_log;
DROP TABLE IF EXISTS import_state;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS album_assets;
DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS derivatives;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS users;
-- +goose StatementEnd
