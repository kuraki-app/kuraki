-- +goose Up
-- +goose StatementBegin

-- Caption/description carried over from imports (e.g. Google Takeout sidecars).
ALTER TABLE assets ADD COLUMN description TEXT;

-- Recreate the FTS index with a description column so captions are searchable,
-- and repopulate it from existing assets.
DROP TABLE IF EXISTS assets_fts;
CREATE VIRTUAL TABLE assets_fts USING fts5(
    asset_id UNINDEXED,
    filename,
    camera_model,
    taken_text,
    description
);
INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description)
SELECT id, filename, camera_model,
       COALESCE(substr(taken_at, 1, 10), ''), COALESCE(description, '')
FROM assets
WHERE deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS assets_fts;
CREATE VIRTUAL TABLE assets_fts USING fts5(
    asset_id UNINDEXED,
    filename,
    camera_model,
    taken_text
);
INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text)
SELECT id, filename, camera_model, COALESCE(substr(taken_at, 1, 10), '')
FROM assets
WHERE deleted_at IS NULL;
ALTER TABLE assets DROP COLUMN description;
-- +goose StatementEnd
