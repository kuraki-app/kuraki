-- +goose Up
CREATE TABLE server_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    id TEXT NOT NULL UNIQUE
);
CREATE TABLE capture_receipts (
    upload_id TEXT PRIMARY KEY REFERENCES upload_sessions(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_capture_receipts_owner ON capture_receipts(owner_id, asset_id);

-- +goose Down
DROP TABLE capture_receipts;
DROP TABLE server_identity;
