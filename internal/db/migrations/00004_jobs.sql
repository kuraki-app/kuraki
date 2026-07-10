-- +goose Up
-- +goose StatementBegin

-- Background import jobs (queue). Uploads and other imports are processed
-- asynchronously by a worker with retries, so the request returns immediately.
CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,        -- UUIDv7
    kind            TEXT NOT NULL,           -- 'upload' | 'import'
    owner           TEXT NOT NULL DEFAULT '',-- owner username
    source          TEXT NOT NULL,           -- staging / source directory
    status          TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
    total           INTEGER NOT NULL DEFAULT 0,
    imported        INTEGER NOT NULL DEFAULT 0,
    duplicates      INTEGER NOT NULL DEFAULT 0,
    skipped         INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    error           TEXT NOT NULL DEFAULT '',
    next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_jobs_runnable ON jobs(status, next_attempt_at);
CREATE INDEX ix_jobs_created ON jobs(created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS jobs;
-- +goose StatementEnd
