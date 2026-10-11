-- +goose Up
-- +goose StatementBegin
-- Catalog deletion and recoverable file cleanup are committed together.
CREATE TABLE storage_cleanup (
    path TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- +goose StatementEnd

-- +goose Down
DROP TABLE storage_cleanup;
