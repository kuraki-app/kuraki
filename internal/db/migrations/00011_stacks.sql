-- +goose Up
-- +goose StatementBegin

-- Stacks group related captures (RAW+JPEG, Live/Motion Photo image+video) so the
-- timeline shows one representative. Members share stack_id (the primary's id);
-- exactly one has stack_primary = 1.
ALTER TABLE assets ADD COLUMN stack_id TEXT;
ALTER TABLE assets ADD COLUMN stack_primary INTEGER NOT NULL DEFAULT 1;
CREATE INDEX ix_assets_stack ON assets(stack_id) WHERE stack_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_stack;
-- SQLite keeps released columns; the runner only moves forward in production.
-- +goose StatementEnd
