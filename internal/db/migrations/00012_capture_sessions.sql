-- +goose Up
-- +goose StatementBegin

CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at TEXT,
    revoked_at TEXT
);
CREATE INDEX ix_devices_owner ON devices(owner_id) WHERE revoked_at IS NULL;

CREATE TABLE upload_sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_dir TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    received_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'receiving',
    job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    error TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK(size_bytes > 0),
    CHECK(received_bytes >= 0 AND received_bytes <= size_bytes)
);
CREATE INDEX ix_upload_sessions_device ON upload_sessions(device_id, updated_at DESC);
CREATE INDEX ix_upload_sessions_expiry ON upload_sessions(expires_at) WHERE status = 'receiving';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_upload_sessions_expiry;
DROP INDEX IF EXISTS ix_upload_sessions_device;
DROP TABLE IF EXISTS upload_sessions;
DROP INDEX IF EXISTS ix_devices_owner;
DROP TABLE IF EXISTS devices;
-- +goose StatementEnd
