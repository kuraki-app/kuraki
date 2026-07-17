-- +goose Up
-- +goose StatementBegin

-- Store pairing codes HASHED at rest, mirroring devices.token_hash: the
-- plaintext one-time code now lives only in the QR shown to the owner and in the
-- claim request; the server persists and looks up only its SHA-256. This keeps a
-- valid code out of the database, logs, and any admin's view.
--
-- Pairing codes are short-lived (5-minute TTL) and single-use, so recreating the
-- table drops any in-flight codes harmlessly — the owner just regenerates the QR.
DROP INDEX IF EXISTS ix_pairing_codes_expiry;
DROP TABLE IF EXISTS pairing_codes;
CREATE TABLE pairing_codes (
    code_hash TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_pairing_codes_expiry ON pairing_codes(expires_at) WHERE claimed_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_pairing_codes_expiry;
DROP TABLE IF EXISTS pairing_codes;
CREATE TABLE pairing_codes (
    code TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_pairing_codes_expiry ON pairing_codes(expires_at) WHERE claimed_at IS NULL;
-- +goose StatementEnd
