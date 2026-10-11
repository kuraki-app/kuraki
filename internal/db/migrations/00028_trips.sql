-- +goose Up
-- +goose StatementBegin

-- Trips are detected groupings of assets captured away from home over a
-- continuous stretch of time. Detection owns baseline membership and re-runs
-- after every import (a Takeout dump of 2019 must be able to join the trip it
-- belongs to), but the user owns naming and may add or remove photos. Both
-- facts have to survive a recompute, which is what the two tables below are
-- shaped around.
CREATE TABLE trips (
    id                TEXT PRIMARY KEY,           -- UUIDv7
    owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- '' means "render the automatic label". The label itself is not stored:
    -- the server keeps the raw facts (dominant place, date range) and the
    -- clients format them through shared/trips.ts, so web and mobile cannot
    -- disagree about how a trip is named.
    name              TEXT NOT NULL DEFAULT '',
    -- A trip whose name the user set is never renamed by detection again, and
    -- is never deleted as stale -- see the deletion rule in internal/trips.
    name_source       TEXT NOT NULL DEFAULT 'auto' CHECK (name_source IN ('auto','user')),
    -- NULL means "pick the cover from members". ON DELETE SET NULL so trashing
    -- the chosen photo degrades to the automatic cover rather than orphaning it.
    cover_asset_id    TEXT REFERENCES assets(id) ON DELETE SET NULL,
    -- The detected span. Recompute matches a fresh cluster to an existing trip
    -- by overlap against this range, which is why it is indexed below.
    started_at        TEXT NOT NULL,
    ended_at          TEXT NOT NULL,
    -- Dominant place among the members, resolved by internal/geo at detection
    -- time. Empty when no member carried GPS.
    place_city        TEXT NOT NULL DEFAULT '',
    place_country     TEXT NOT NULL DEFAULT '',
    hidden            INTEGER NOT NULL DEFAULT 0,
    algorithm_version INTEGER NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_trips_owner_range ON trips(owner_id, started_at DESC);

-- Membership, with the source of each row recorded.
--
-- The primary key is what makes user edits survive a recompute, so it is
-- load-bearing rather than incidental: an asset has at most ONE row per trip,
-- so 'removed' is not a separate tombstone list -- it REPLACES the 'detected'
-- row. Effective membership is therefore just source IN ('detected','added').
--
-- Recompute is two statements:
--
--   DELETE FROM trip_members WHERE trip_id = ? AND source = 'detected';
--   INSERT OR IGNORE INTO trip_members (trip_id, asset_id, source)
--        VALUES (?, ?, 'detected');
--
-- OR IGNORE does the real work: an asset the user added or removed still holds
-- its row, so detection cannot overwrite that decision. This is the same rule
-- internal/stacks applies with stack_locked ("a heuristic must not second-guess
-- an explicit decision"), generalised from per-asset to per-membership.
CREATE TABLE trip_members (
    trip_id  TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source   TEXT NOT NULL CHECK (source IN ('detected','added','removed')),
    PRIMARY KEY (trip_id, asset_id)
);
-- Backs the `trip=<id>` filter's JOIN in parseAssetFilters, which reaches this
-- table by asset_id rather than by trip_id.
CREATE INDEX ix_trip_members_asset ON trip_members(asset_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS trip_members;
DROP TABLE IF EXISTS trips;
-- +goose StatementEnd
