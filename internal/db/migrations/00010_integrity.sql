-- +goose Up
-- +goose StatementBegin

-- Results of scheduled/manual integrity verification runs, so the library can
-- report "last verified" and surface problems without re-running a full scan.
CREATE TABLE integrity_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    checked     INTEGER NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 0,
    problems    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL CHECK (status IN ('running','clean','problems','error'))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS integrity_runs;
-- +goose StatementEnd
