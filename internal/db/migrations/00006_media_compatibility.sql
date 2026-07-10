-- +goose Up
-- +goose StatementBegin

-- Whether the asset currently has a safe path for the browser viewer. The
-- original always remains downloadable even when this is false.
ALTER TABLE assets ADD COLUMN web_viewable INTEGER NOT NULL DEFAULT 0;

-- Existing browser-native assets retain their current viewing behaviour.
UPDATE assets
SET web_viewable = 1
WHERE (media_type = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'))
   OR (media_type = 'video' AND mime_type IN ('video/mp4', 'video/webm'));

-- Derivative failures are durable and actionable, rather than causing a
-- repeat import of an original that has already been safely stored.
CREATE TABLE media_issues (
    asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('thumbnail', 'poster', 'preview', 'playback')),
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (asset_id, kind)
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS media_issues;
-- SQLite cannot remove a column without rebuilding the released table; the
-- migration runner only moves forward in production, so retain the flag.
-- +goose StatementEnd
