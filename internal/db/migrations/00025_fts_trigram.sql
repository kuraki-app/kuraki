-- +goose Up
-- +goose StatementBegin

-- A second full-text index over the same columns, tokenized into overlapping
-- three-character sequences.
--
-- The default tokenizer in assets_fts can only match the start of a token, so
-- "reensho" finds nothing and a filename search only works if you already know
-- how the name begins -- useless in a library where every file is called
-- "Screenshot ...". Trigram matches anywhere inside a token, at the cost of
-- being unable to answer a query shorter than 3 characters, which is why
-- assets_fts stays rather than being replaced: it serves the short queries.
--
-- The backfill mirrors 00003 and 00014: rebuild from assets, skipping
-- soft-deleted rows.
CREATE VIRTUAL TABLE assets_fts_tri USING fts5(
    asset_id UNINDEXED,
    filename,
    camera_model,
    taken_text,
    description,
    ocr_text,
    tokenize='trigram'
);

INSERT INTO assets_fts_tri (asset_id, filename, camera_model, taken_text, description, ocr_text)
SELECT id, filename, camera_model,
       COALESCE(substr(taken_at, 1, 10), ''), COALESCE(description, ''), COALESCE(ocr_text, '')
FROM assets
WHERE deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS assets_fts_tri;
-- +goose StatementEnd
