-- +goose Up
-- +goose StatementBegin

-- Resolved place names from GPS via offline reverse geocoding (Places view).
-- Nullable; populated at import for assets that carry GPS, and backfilled on
-- startup for assets imported before this migration.
ALTER TABLE assets ADD COLUMN place_city TEXT;
ALTER TABLE assets ADD COLUMN place_country TEXT;

CREATE INDEX ix_assets_place ON assets(owner_id, place_country, place_city);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_place;
ALTER TABLE assets DROP COLUMN place_country;
ALTER TABLE assets DROP COLUMN place_city;
-- +goose StatementEnd
