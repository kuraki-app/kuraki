-- +goose Up
-- +goose StatementBegin

-- Admin-writable server settings (Settings consolidation). Key/value rather
-- than a column per setting, so a future setting needs no new migration.
-- Precedence at read time is defaults < this table < environment < CLI
-- flags — see internal/config.ApplyDB. An empty stored value is a deliberate
-- "clear this" for keys like backup_dir/metrics_token, distinct from no row
-- at all, so this table is never pruned automatically.
CREATE TABLE server_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS server_settings;
-- +goose StatementEnd
