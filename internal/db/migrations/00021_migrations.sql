-- +goose Up
-- +goose StatementBegin

-- Library migrations from another photo server (Immich today; Google Takeout
-- later). Two tables: one row per run, and a durable source-id -> local-id map.
--
-- migration_map is deliberately keyed on (owner, source, kind, source_id) rather
-- than on run_id. That is what makes a second run against the same server a
-- no-op instead of a duplicated library, and what lets an interrupted run resume
-- without re-downloading anything.
CREATE TABLE migration_runs (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','canceled')),
    total       INTEGER NOT NULL DEFAULT 0,
    processed   INTEGER NOT NULL DEFAULT 0,
    imported    INTEGER NOT NULL DEFAULT 0,
    duplicates  INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    cursor      TEXT NOT NULL DEFAULT '',
    error       TEXT NOT NULL DEFAULT '',
    started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT
);
CREATE INDEX ix_migration_runs_owner ON migration_runs(owner_id, started_at DESC);

CREATE TABLE migration_map (
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('asset','album','tag','stack')),
    source_id  TEXT NOT NULL,
    local_id   TEXT,
    status     TEXT NOT NULL CHECK (status IN ('done','duplicate','skipped','error')),
    error      TEXT NOT NULL DEFAULT '',
    run_id     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (owner_id, source, kind, source_id)
);
CREATE INDEX ix_migration_map_run ON migration_map(run_id);

-- Immich albums carry a description; Kuraki's did not. Migrating one would
-- otherwise silently drop it.
ALTER TABLE albums ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- stacks.Detect rebuilds every stack from filename heuristics on each import,
-- which would erase a stack a migration carried over from a source server that
-- stated it explicitly. Locked stacks are left alone by detection.
ALTER TABLE assets ADD COLUMN stack_locked INTEGER NOT NULL DEFAULT 0;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_migration_map_run;
DROP TABLE IF EXISTS migration_map;
DROP INDEX IF EXISTS ix_migration_runs_owner;
DROP TABLE IF EXISTS migration_runs;
ALTER TABLE assets DROP COLUMN stack_locked;
ALTER TABLE albums DROP COLUMN description;
-- +goose StatementEnd
