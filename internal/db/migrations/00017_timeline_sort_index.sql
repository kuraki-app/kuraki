-- +goose Up
-- +goose StatementBegin

-- The timeline, search, places, and mobile library all page by
-- `ORDER BY COALESCE(taken_at, created_at) DESC, id DESC` with a matching cursor
-- predicate. Existing indexes end in bare `taken_at`, so the sort key — the
-- COALESCE *expression* — could not be served from an index: every page forced a
-- full filter + "USE TEMP B-TREE FOR ORDER BY" over the whole non-deleted set,
-- growing linearly with the library.
--
-- This expression index carries the same leading equality filters as the default
-- view (archived / hidden / deleted_at) followed by the exact sort expression and
-- the id tie-breaker, both DESC, so a page becomes an index seek to the cursor
-- position that stops after LIMIT rows. Verified against a 50k-asset library:
-- the temp B-tree disappears from the query plan for the timeline, cursor
-- pagination, and place-filtered views.
CREATE INDEX ix_assets_timeline
    ON assets(archived, hidden, deleted_at, COALESCE(taken_at, created_at) DESC, id DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ix_assets_timeline;
-- +goose StatementEnd
