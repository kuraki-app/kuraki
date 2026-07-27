package migrate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Entity kinds tracked in migration_map.
const (
	KindAsset = "asset"
	KindAlbum = "album"
	KindTag   = "tag"
	KindStack = "stack"
)

// Per-item outcomes recorded in migration_map.
const (
	StatusDone      = "done"
	StatusDuplicate = "duplicate"
	StatusSkipped   = "skipped"
	StatusError     = "error"
)

// Run statuses.
const (
	RunRunning   = "running"
	RunSucceeded = "succeeded"
	RunFailed    = "failed"
	RunCanceled  = "canceled"
)

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// Run is one migration attempt against one source server.
type Run struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	OwnerID    string `json:"owner_id"`
	Endpoint   string `json:"endpoint"`
	Status     string `json:"status"`
	Total      int    `json:"total"`
	Processed  int    `json:"processed"`
	Imported   int    `json:"imported"`
	Duplicates int    `json:"duplicates"`
	Skipped    int    `json:"skipped"`
	Errors     int    `json:"errors"`
	Cursor     string `json:"cursor"`
	Error      string `json:"error,omitempty"`
	StartedAt  string `json:"started_at"`
	UpdatedAt  string `json:"updated_at"`
	FinishedAt string `json:"finished_at,omitempty"`
}

func insertRun(ctx context.Context, db *sql.DB, r Run) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO migration_runs (id, source, owner_id, endpoint, status, total, started_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Source, r.OwnerID, r.Endpoint, RunRunning, r.Total, nowText(), nowText())
	if err != nil {
		return fmt.Errorf("migrate: insert run: %w", err)
	}
	return nil
}

// LoadRun reads a run by id.
func LoadRun(ctx context.Context, db *sql.DB, id string) (Run, error) {
	var r Run
	var finished sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT id, source, owner_id, endpoint, status, total, processed, imported,
		       duplicates, skipped, errors, cursor, error, started_at, updated_at, finished_at
		FROM migration_runs WHERE id = ?`, id).
		Scan(&r.ID, &r.Source, &r.OwnerID, &r.Endpoint, &r.Status, &r.Total, &r.Processed,
			&r.Imported, &r.Duplicates, &r.Skipped, &r.Errors, &r.Cursor, &r.Error,
			&r.StartedAt, &r.UpdatedAt, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, fmt.Errorf("migrate: no run %q", id)
	}
	if err != nil {
		return Run{}, fmt.Errorf("migrate: load run: %w", err)
	}
	r.FinishedAt = finished.String
	return r, nil
}

// ListRuns returns runs newest first.
func ListRuns(ctx context.Context, db *sql.DB, limit int) ([]Run, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, source, owner_id, endpoint, status, total, processed, imported,
		       duplicates, skipped, errors, cursor, error, started_at, updated_at, finished_at
		FROM migration_runs ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("migrate: list runs: %w", err)
	}
	defer rows.Close()

	out := make([]Run, 0)
	for rows.Next() {
		var r Run
		var finished sql.NullString
		if err := rows.Scan(&r.ID, &r.Source, &r.OwnerID, &r.Endpoint, &r.Status, &r.Total,
			&r.Processed, &r.Imported, &r.Duplicates, &r.Skipped, &r.Errors, &r.Cursor,
			&r.Error, &r.StartedAt, &r.UpdatedAt, &finished); err != nil {
			return nil, fmt.Errorf("migrate: scan run: %w", err)
		}
		r.FinishedAt = finished.String
		out = append(out, r)
	}
	return out, rows.Err()
}

// saveProgress writes the running counters and cursor for a run.
func (e *Engine) saveProgress(ctx context.Context, r *Run) {
	_, _ = e.DB.ExecContext(ctx, `
		UPDATE migration_runs SET total = ?, processed = ?, imported = ?, duplicates = ?,
		    skipped = ?, errors = ?, cursor = ?, updated_at = ? WHERE id = ?`,
		r.Total, r.Processed, r.Imported, r.Duplicates, r.Skipped, r.Errors,
		r.Cursor, nowText(), r.ID)

	// Mirror into the job row (if this run is driven by one) so the existing
	// Activity UI shows live progress rather than a frozen zero until the end.
	if e.JobID != "" {
		_, _ = e.DB.ExecContext(ctx, `
			UPDATE jobs SET total = ?, imported = ?, duplicates = ?, skipped = ?,
			    errors = ?, updated_at = ? WHERE id = ?`,
			r.Total, r.Imported, r.Duplicates, r.Skipped, r.Errors, nowText(), e.JobID)
	}
}

func finishRun(ctx context.Context, db *sql.DB, r Run, status, message string) {
	_, _ = db.ExecContext(ctx, `
		UPDATE migration_runs SET status = ?, total = ?, processed = ?, imported = ?,
		    duplicates = ?, skipped = ?, errors = ?, cursor = ?, error = ?,
		    updated_at = ?, finished_at = ? WHERE id = ?`,
		status, r.Total, r.Processed, r.Imported, r.Duplicates, r.Skipped, r.Errors,
		r.Cursor, message, nowText(), nowText(), r.ID)
}

// mapEntry is one recorded source-id -> local-id association.
type mapEntry struct {
	LocalID string
	Status  string
}

// loadMap reads every recorded mapping of one kind for an owner+source. The
// whole set is held in memory on purpose: it is two short strings per item, and
// having it resident turns the "have I already done this?" check in the hot
// loop into a map lookup instead of a query per asset.
func loadMap(ctx context.Context, db *sql.DB, ownerID, source, kind string) (map[string]mapEntry, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT source_id, COALESCE(local_id, ''), status FROM migration_map
		WHERE owner_id = ? AND source = ? AND kind = ?`, ownerID, source, kind)
	if err != nil {
		return nil, fmt.Errorf("migrate: load %s map: %w", kind, err)
	}
	defer rows.Close()

	out := make(map[string]mapEntry)
	for rows.Next() {
		var sourceID, localID, status string
		if err := rows.Scan(&sourceID, &localID, &status); err != nil {
			return nil, fmt.Errorf("migrate: scan %s map: %w", kind, err)
		}
		out[sourceID] = mapEntry{LocalID: localID, Status: status}
	}
	return out, rows.Err()
}

// recordMapping upserts one source-id -> local-id association. Re-running a
// migration overwrites a previous 'error' row with the eventual success.
func recordMapping(ctx context.Context, db execer, ownerID, source, kind, sourceID, localID, status, message, runID string) error {
	var local any
	if localID != "" {
		local = localID
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO migration_map (owner_id, source, kind, source_id, local_id, status, error, run_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_id, source, kind, source_id) DO UPDATE SET
			local_id = excluded.local_id,
			status = excluded.status,
			error = excluded.error,
			run_id = excluded.run_id
	`, ownerID, source, kind, sourceID, local, status, message, runID, nowText())
	if err != nil {
		return fmt.Errorf("migrate: record %s mapping: %w", kind, err)
	}
	return nil
}

// execer is satisfied by both *sql.DB and *sql.Tx.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// done reports whether an entry represents work that need not be redone. An
// errored entry is retried on the next run; a skipped one is not, because the
// reason (unsupported media type) will not change.
func (m mapEntry) done() bool {
	return m.Status == StatusDone || m.Status == StatusDuplicate || m.Status == StatusSkipped
}
