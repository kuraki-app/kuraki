-- +goose Up
-- +goose StatementBegin

-- Short-lived, single-use codes that let an owner pair a new device (phone) by
-- QR without typing a token. An authenticated web session mints one; the device
-- redeems it once, before expiry, to receive its own revocable device token.
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

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_pairing_codes_expiry;
DROP TABLE IF EXISTS pairing_codes;
-- +goose StatementEnd
