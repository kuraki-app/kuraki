package backup

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// RunSummary is the recorded outcome of an automatic backup.
type RunSummary struct {
	StartedAt   string `json:"started_at"`
	FinishedAt  string `json:"finished_at,omitempty"`
	Destination string `json:"destination,omitempty"`
	Bytes       int64  `json:"bytes"`
	Status      string `json:"status"` // running | ok | error
	Error       string `json:"error,omitempty"`
}

// backupPrefix names automatic archives so they can be recognised for pruning.
const backupPrefix = "kuraki-backup-"

// RunAndRecord writes a SQLite-consistent library backup into dir and records
// the outcome in backup_runs, so the dashboard can report backup age without
// scanning the directory. The archive name carries a UTC timestamp; a failed
// run leaves a row with status 'error' rather than silently vanishing.
func RunAndRecord(ctx context.Context, db *sql.DB, dataDir, dir string) (RunSummary, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return RunSummary{}, fmt.Errorf("backup: create destination dir: %w", err)
	}
	dest := filepath.Join(dir, backupPrefix+time.Now().UTC().Format("20060102T150405Z")+".tar.gz")

	res, err := db.ExecContext(ctx,
		`INSERT INTO backup_runs (started_at, destination, status) VALUES (?, ?, 'running')`,
		nowText(), dest)
	if err != nil {
		return RunSummary{}, err
	}
	id, _ := res.LastInsertId()

	runErr := CreateLive(ctx, db, dataDir, dest)

	summary := RunSummary{StartedAt: nowText(), Destination: dest, Status: "ok"}
	if runErr != nil {
		summary.Status = "error"
		summary.Error = runErr.Error()
		// A partial archive from a failed run is not a usable backup; remove it.
		_ = os.Remove(dest)
	} else if info, statErr := os.Stat(dest); statErr == nil {
		summary.Bytes = info.Size()
	}

	_, _ = db.ExecContext(ctx, `
		UPDATE backup_runs SET finished_at = ?, bytes = ?, status = ?, error = ?
		WHERE id = ?`, nowText(), summary.Bytes, summary.Status, summary.Error, id)
	return summary, runErr
}

// LastRun returns the most recent automatic backup, if any.
func LastRun(ctx context.Context, db *sql.DB) (RunSummary, bool, error) {
	var s RunSummary
	var finished sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT started_at, finished_at, destination, bytes, status, error
		FROM backup_runs ORDER BY id DESC LIMIT 1`).
		Scan(&s.StartedAt, &finished, &s.Destination, &s.Bytes, &s.Status, &s.Error)
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

// Prune keeps only the newest keep automatic archives in dir, deleting older
// ones so unattended backups do not grow without bound. keep <= 0 is a no-op.
func Prune(dir string, keep int) error {
	if keep <= 0 {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var archives []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), backupPrefix) && strings.HasSuffix(e.Name(), ".tar.gz") {
			archives = append(archives, e.Name())
		}
	}
	// Timestamped names sort chronologically; newest last.
	sort.Strings(archives)
	if len(archives) <= keep {
		return nil
	}
	for _, name := range archives[:len(archives)-keep] {
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
