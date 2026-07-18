-- +goose Up
-- +goose StatementBegin

-- change_log gains owner_id so the delta feed (GET /api/changes) can be
-- owner-scoped even for a PURGED asset, whose assets row is gone and could not
-- be joined for its owner. Existing rows are backfilled from the still-present
-- asset; rows whose asset was already purged stay NULL and are treated as
-- visible to the sole Phase-1 owner by the feed query.
ALTER TABLE change_log ADD COLUMN owner_id TEXT;

UPDATE change_log
SET owner_id = (SELECT owner_id FROM assets WHERE assets.id = change_log.entity_id)
WHERE owner_id IS NULL;

CREATE INDEX ix_change_log_owner_id ON change_log(owner_id, id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_change_log_owner_id;
ALTER TABLE change_log DROP COLUMN owner_id;
-- +goose StatementEnd
