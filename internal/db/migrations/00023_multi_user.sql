-- +goose Up
-- +goose StatementBegin

-- Multi-user, isolated-libraries model: owner_id is a hard wall. An admin
-- manages accounts, not photos -- there is deliberately no way for one user to
-- read another's library.

-- role gates account management only. Existing installs have exactly one user,
-- who owns the server and must keep full control of it, so they become admin.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin','user'));
UPDATE users SET role = 'admin';

-- Soft disable. Revoking access must not destroy a library, so disabling only
-- kills sessions and device tokens; the user's assets are untouched and the
-- action is reversible. Deletion is a separate, explicitly-opted-into purge.
ALTER TABLE users ADD COLUMN disabled_at TEXT;

-- Pre-00020 change_log rows for assets that were already purged could not be
-- backfilled (no assets row to join) and were left NULL, then treated as
-- visible to the sole owner by an `OR owner_id IS NULL` clause in the feed.
-- That clause is a cross-owner leak once a second account exists. These rows
-- are historical single-owner data, so attribute them to that owner and drop
-- the clause. Assigning rather than deleting avoids moving MIN(id), which
-- would force connected clients into a spurious full resync.
UPDATE change_log
SET owner_id = (SELECT id FROM users ORDER BY created_at, rowid LIMIT 1)
WHERE owner_id IS NULL;

-- import_state.source_path was a bare PRIMARY KEY, making resume/skip state
-- global. Two users importing the same path -- a shared NAS mount, the same
-- external drive -- would have the second silently skipped as "already done",
-- so their library would be missing files with no error. SQLite cannot alter a
-- primary key in place, so the table is rebuilt.
CREATE TABLE import_state_new (
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_path  TEXT NOT NULL,
    size         INTEGER NOT NULL,
    mtime        TEXT NOT NULL,
    content_hash TEXT,
    status       TEXT NOT NULL CHECK (status IN ('pending','done','skipped','error')),
    error        TEXT NOT NULL DEFAULT '',
    imported_at  TEXT,
    PRIMARY KEY (owner_id, source_path)
);

INSERT INTO import_state_new (owner_id, source_path, size, mtime, content_hash, status, error, imported_at)
SELECT (SELECT id FROM users ORDER BY created_at, rowid LIMIT 1),
       source_path, size, mtime, content_hash, status, error, imported_at
FROM import_state
WHERE (SELECT COUNT(*) FROM users) > 0;

DROP TABLE import_state;
ALTER TABLE import_state_new RENAME TO import_state;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TABLE import_state_old (
    source_path  TEXT PRIMARY KEY,
    size         INTEGER NOT NULL,
    mtime        TEXT NOT NULL,
    content_hash TEXT,
    status       TEXT NOT NULL CHECK (status IN ('pending','done','skipped','error')),
    error        TEXT NOT NULL DEFAULT '',
    imported_at  TEXT
);
INSERT OR IGNORE INTO import_state_old (source_path, size, mtime, content_hash, status, error, imported_at)
SELECT source_path, size, mtime, content_hash, status, error, imported_at FROM import_state;
DROP TABLE import_state;
ALTER TABLE import_state_old RENAME TO import_state;

ALTER TABLE users DROP COLUMN disabled_at;
ALTER TABLE users DROP COLUMN role;
-- +goose StatementEnd
