-- +goose Up
-- +goose StatementBegin

-- Viewport map queries always constrain the owner and latitude range before
-- grouping or returning individual points. This partial index keeps deleted
-- and GPS-less assets out of the map path while preserving the pure-Go SQLite
-- storage contract.
CREATE INDEX ix_assets_owner_gps_lat_lon
    ON assets(owner_id, gps_lat, gps_lon)
    WHERE deleted_at IS NULL AND gps_lat IS NOT NULL AND gps_lon IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_owner_gps_lat_lon;
-- +goose StatementEnd
