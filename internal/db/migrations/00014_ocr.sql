-- +goose Up
-- +goose StatementBegin

-- Text recognised from images by the opt-in local OCR worker. Indexed into FTS
-- so a search for words inside a screenshot or document finds the image.
ALTER TABLE assets ADD COLUMN ocr_text TEXT;

DROP TABLE IF EXISTS assets_fts;
CREATE VIRTUAL TABLE assets_fts USING fts5(
    asset_id UNINDEXED,
    filename,
    camera_model,
    taken_text,
    description,
    ocr_text
);
INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description, ocr_text)
SELECT id, filename, camera_model,
       COALESCE(substr(taken_at, 1, 10), ''), COALESCE(description, ''), COALESCE(ocr_text, '')
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
    taken_text,
    description
);
INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description)
SELECT id, filename, camera_model,
       COALESCE(substr(taken_at, 1, 10), ''), COALESCE(description, '')
FROM assets
WHERE deleted_at IS NULL;
ALTER TABLE assets DROP COLUMN ocr_text;
-- +goose StatementEnd
