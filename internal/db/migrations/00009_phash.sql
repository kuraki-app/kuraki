-- +goose Up
-- +goose StatementBegin

-- Perceptual hash (dHash) of an image, for finding visually identical or
-- near-identical copies that byte-level dedup does not catch. Nullable: videos
-- and images without a decodable thumbnail have none.
ALTER TABLE assets ADD COLUMN phash INTEGER;
CREATE INDEX ix_assets_phash ON assets(phash) WHERE phash IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_phash;
-- SQLite keeps released columns; the runner only moves forward in production.
-- +goose StatementEnd
