-- +goose Up
-- +goose StatementBegin

-- Per-file errors for an import job, so the Activity view can show exactly which
-- files failed and why (rather than just a count).
CREATE TABLE job_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    error      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_job_errors_job ON job_errors(job_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS job_errors;
-- +goose StatementEnd
