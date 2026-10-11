-- +goose Up
-- +goose StatementBegin
ALTER TABLE jobs ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Capture receipts are authoritative even where the old worker interpreted an
-- account UUID as a username. Unknown legacy jobs stay invisible, not shared.
UPDATE jobs SET owner_id = COALESCE(
    (SELECT owner_id FROM upload_sessions WHERE job_id = jobs.id LIMIT 1),
    (SELECT id FROM users WHERE username = jobs.owner),
    (SELECT id FROM users WHERE id = jobs.owner),
    CASE WHEN owner = '' THEN (SELECT id FROM users WHERE username = 'owner') END
);
CREATE INDEX ix_jobs_owner_created ON jobs(owner_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX ix_jobs_owner_created;
ALTER TABLE jobs DROP COLUMN owner_id;
-- +goose StatementEnd
