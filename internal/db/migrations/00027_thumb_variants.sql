-- +goose Up
-- +goose StatementBegin

-- derivative_gen advances on every rebuild so each regenerated derivative is
-- written to a fresh path (originals and derivatives are never overwritten in
-- place) and clients receive a new URL version.
ALTER TABLE assets ADD COLUMN derivative_gen INTEGER NOT NULL DEFAULT 0;

-- Extra thumbnail tiers created on first request. The medium tier stays in
-- derivatives (kind 'thumb' / 'poster'); only sizes a client asked for live here.
CREATE TABLE thumb_variants (
    asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    edge       INTEGER NOT NULL CHECK (edge IN (256, 1200)),
    gen        INTEGER NOT NULL,
    format     TEXT NOT NULL,
    path       TEXT NOT NULL,
    width      INTEGER NOT NULL DEFAULT 0,
    height     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (asset_id, edge)
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS thumb_variants;
ALTER TABLE assets DROP COLUMN derivative_gen;
-- +goose StatementEnd
