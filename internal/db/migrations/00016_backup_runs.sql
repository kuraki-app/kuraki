-- +goose Up
-- +goose StatementBegin

-- Results of scheduled/automatic library backups, so the dashboard can report
-- "last backup" age and the most recent outcome without inspecting the backup
-- directory. Manual `kuraki backup` runs are intentionally not recorded here;
-- this tracks the unattended safety net a passive user relies on.
CREATE TABLE backup_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    destination TEXT NOT NULL DEFAULT '',
    bytes       INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL CHECK (status IN ('running','ok','error')),
    error       TEXT NOT NULL DEFAULT ''
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS backup_runs;
-- +goose StatementEnd
