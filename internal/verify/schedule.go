package verify

import (
	"context"
	"database/sql"
	"time"

	"github.com/kuraki-app/kuraki/internal/storage"
)

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// RunSummary is the recorded outcome of an integrity verification run.
type RunSummary struct {
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at,omitempty"`
	Checked    int    `json:"checked"`
	OK         int    `json:"ok"`
	Problems   int    `json:"problems"`
	Status     string `json:"status"` // running | clean | problems | error
}

// RunAndRecord verifies the library and records the outcome in integrity_runs,
// so the result is queryable without re-scanning. Shared by the scheduler and
// the manual "verify now" action.
func RunAndRecord(ctx context.Context, db *sql.DB, store storage.Storage) (Result, error) {
	res, err := db.ExecContext(ctx,
		`INSERT INTO integrity_runs (started_at, status) VALUES (?, 'running')`, nowText())
	if err != nil {
		return Result{}, err
	}
	id, _ := res.LastInsertId()

	v := Verifier{DB: db, Store: store}
	result, runErr := v.Run(ctx, nil)

	status := "clean"
	switch {
	case runErr != nil:
		status = "error"
	case !result.Healthy():
		status = "problems"
	}
	_, _ = db.ExecContext(ctx, `
		UPDATE integrity_runs SET finished_at = ?, checked = ?, ok = ?, problems = ?, status = ?
		WHERE id = ?`, nowText(), result.Checked, result.OK, len(result.Problems), status, id)
	return result, runErr
}

// LastRun returns the most recent verification run, if any.
func LastRun(ctx context.Context, db *sql.DB) (RunSummary, bool, error) {
	var s RunSummary
	var finished sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT started_at, finished_at, checked, ok, problems, status
		FROM integrity_runs ORDER BY id DESC LIMIT 1`).
		Scan(&s.StartedAt, &finished, &s.Checked, &s.OK, &s.Problems, &s.Status)
	if err == sql.ErrNoRows {
		return RunSummary{}, false, nil
	}
	if err != nil {
		return RunSummary{}, false, err
	}
	if finished.Valid {
		s.FinishedAt = finished.String
	}
	return s, true, nil
}
