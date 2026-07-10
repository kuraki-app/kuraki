-- +goose Up
-- +goose StatementBegin

CREATE TABLE external_libraries (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    root_path  TEXT NOT NULL,
    read_only  INTEGER NOT NULL DEFAULT 1 CHECK (read_only = 1),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(owner_id, name),
    UNIQUE(owner_id, root_path)
);

ALTER TABLE assets ADD COLUMN external_library_id TEXT REFERENCES external_libraries(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN external_path TEXT;
CREATE UNIQUE INDEX ux_assets_external_path ON assets(external_library_id, external_path) WHERE external_library_id IS NOT NULL;
CREATE INDEX ix_assets_external_library ON assets(external_library_id, deleted_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_external_library;
DROP INDEX IF EXISTS ux_assets_external_path;
DROP TABLE IF EXISTS external_libraries;
-- SQLite keeps added columns on down migrations to avoid rebuilding released data.
-- +goose StatementEnd
