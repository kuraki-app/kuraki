-- +goose Up
-- +goose StatementBegin

CREATE TABLE duplicate_runs (
    id                TEXT PRIMARY KEY,
    owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status            TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
    algorithm_version INTEGER NOT NULL,
    total             INTEGER NOT NULL DEFAULT 0,
    processed         INTEGER NOT NULL DEFAULT 0,
    group_count       INTEGER NOT NULL DEFAULT 0,
    error             TEXT NOT NULL DEFAULT '',
    started_at        TEXT,
    finished_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_duplicate_runs_owner ON duplicate_runs(owner_id, created_at DESC);

CREATE TABLE duplicate_group_members (
    run_id   TEXT NOT NULL REFERENCES duplicate_runs(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (run_id, group_id, asset_id)
);
CREATE INDEX ix_duplicate_group_members_run ON duplicate_group_members(run_id, group_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS duplicate_group_members;
DROP TABLE IF EXISTS duplicate_runs;
-- +goose StatementEnd
