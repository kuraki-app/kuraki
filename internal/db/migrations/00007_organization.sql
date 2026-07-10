-- +goose Up
-- +goose StatementBegin

-- Lightweight organization state. These fields never alter originals and keep
-- the timeline fast through owner/state indexes.
ALTER TABLE assets ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5);
ALTER TABLE assets ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE INDEX ix_assets_owner_library_state ON assets(owner_id, archived, hidden, deleted_at, taken_at);

CREATE TABLE tags (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL COLLATE NOCASE,
    parent_id  TEXT REFERENCES tags(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(owner_id, name)
);
CREATE TABLE asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX ix_asset_tags_tag ON asset_tags(tag_id, asset_id);

CREATE TABLE saved_searches (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    query_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(owner_id, name)
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS saved_searches;
DROP INDEX IF EXISTS ix_asset_tags_tag;
DROP TABLE IF EXISTS asset_tags;
DROP TABLE IF EXISTS tags;
DROP INDEX IF EXISTS ix_assets_owner_library_state;
-- SQLite keeps added columns on down migrations to avoid rebuilding released data.
-- +goose StatementEnd
