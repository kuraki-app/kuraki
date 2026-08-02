-- +goose Up
-- +goose StatementBegin

-- The capture upload's own idea of when the item was taken.
--
-- A phone knows each camera-roll item's creation time exactly, but nothing in
-- the upload protocol carried it, so the server had only the file's bytes to go
-- on. Screenshots and other EXIF-less media therefore imported with no
-- capture date at all and grouped under "Undated" in every client.
--
-- Recorded at session start and applied to the staged file's mtime at
-- completion, so the importer's ordinary date resolution picks it up without
-- the queue or the job payload having to learn about it.
ALTER TABLE upload_sessions ADD COLUMN taken_at TEXT;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE upload_sessions DROP COLUMN taken_at;

-- +goose StatementEnd
