-- +goose Up
-- +goose StatementBegin

-- album_assets is keyed by PRIMARY KEY (album_id, asset_id), which serves
-- membership lookups for a given album. The reverse direction — "which albums
-- contain this asset?" and the ON DELETE CASCADE that fires when an asset is
-- trashed/purged — had no supporting index and scanned the whole join table per
-- asset. Index asset_id so both stay O(log n) as libraries grow (roadmap:
-- Harden — operational edges, album indexing ahead of large libraries).
CREATE INDEX IF NOT EXISTS ix_album_assets_asset ON album_assets(asset_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_album_assets_asset;
-- +goose StatementEnd
