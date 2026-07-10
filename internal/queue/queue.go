// Package queue runs imports asynchronously. Uploads are staged to disk and
// enqueued as jobs; a background worker processes them one at a time (each
// import is already internally concurrent), with retries and crash recovery, so
// the HTTP request returns immediately and the UI can poll progress.
package queue

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/stacks"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// Job is one unit of background import work.
type Job struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Status     string `json:"status"`
	Total      int    `json:"total"`
	Imported   int    `json:"imported"`
	Duplicates int    `json:"duplicates"`
	Skipped    int    `json:"skipped"`
	Errors     int    `json:"errors"`
	Attempts   int    `json:"attempts"`
	Error      string `json:"error,omitempty"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`

	source string // staging/source dir; not serialized
}

// Queue owns the job store and the worker.
type Queue struct {
	DB         *sql.DB
	Store      storage.Storage
	Media      media.Processor
	ThumbSize  int
	StagingDir string
	Log        *slog.Logger

	wake chan struct{}
}

// New builds a Queue and ensures the staging directory exists.
func New(db *sql.DB, store storage.Storage, m media.Processor, thumbSize int, stagingDir string, log *slog.Logger) (*Queue, error) {
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, fmt.Errorf("queue: staging dir: %w", err)
	}
	return &Queue{
		DB: db, Store: store, Media: m, ThumbSize: thumbSize,
		StagingDir: stagingDir, Log: log, wake: make(chan struct{}, 1),
	}, nil
}

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// EnqueueUpload stages uploaded files and queues a job for them.
func (q *Queue) EnqueueUpload(ctx context.Context, owner string, files []*multipart.FileHeader) (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	jobID := id.String()
	dir := filepath.Join(q.StagingDir, jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("queue: stage dir: %w", err)
	}
	for index, fh := range files {
		// Each upload gets its own subdirectory. Browsers routinely upload
		// several files with the same basename (for example IMG_0001.jpg from
		// different folders); staging them directly in dir would overwrite the
		// earlier file before the importer ever sees it.
		fileDir := filepath.Join(dir, fmt.Sprintf("%06d", index+1))
		if err := os.MkdirAll(fileDir, 0o755); err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("queue: stage upload directory: %w", err)
		}
		if err := stage(fileDir, fh); err != nil {
			os.RemoveAll(dir)
			return "", err
		}
	}
	if err := q.enqueueStagedDirectory(ctx, jobID, owner, dir, len(files), "upload"); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return jobID, nil
}

// EnqueueStagedDirectory queues an already-uploaded directory. Capture clients
// use resumable writes directly into staging, then hand the completed directory
// to the same importer and crash-recovery path as browser uploads.
func (q *Queue) EnqueueStagedDirectory(ctx context.Context, owner, dir string, total int) (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	jobID := id.String()
	if err := q.enqueueStagedDirectory(ctx, jobID, owner, dir, total, "capture"); err != nil {
		return "", err
	}
	return jobID, nil
}

func (q *Queue) enqueueStagedDirectory(ctx context.Context, jobID, owner, dir string, total int, kind string) error {
	if total < 1 {
		return fmt.Errorf("queue: staged job has no files")
	}
	if _, err := q.DB.ExecContext(ctx, `
		INSERT INTO jobs (id, kind, owner, source, status, total, next_attempt_at)
		VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
		jobID, kind, owner, dir, total, nowText()); err != nil {
		return fmt.Errorf("queue: insert job: %w", err)
	}
	q.signal()
	return nil
}

func stage(dir string, fh *multipart.FileHeader) error {
	src, err := fh.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	name := filepath.Base(fh.Filename)
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return fmt.Errorf("queue: invalid upload filename %q", fh.Filename)
	}
	dst, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("queue: create staged file: %w", err)
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}

func (q *Queue) signal() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// Start recovers interrupted jobs and runs the worker until ctx is cancelled.
func (q *Queue) Start(ctx context.Context) {
	// Crash recovery: anything left 'running' is requeued.
	if _, err := q.DB.ExecContext(ctx,
		`UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'`, nowText()); err != nil {
		q.Log.Warn("queue: recover running jobs failed", "err", err)
	}

	ticker := time.NewTicker(3 * time.Second) // also catches scheduled retries
	defer ticker.Stop()
	for {
		for {
			job, ok := q.claim(ctx)
			if !ok {
				break
			}
			q.process(ctx, job)
		}
		select {
		case <-ctx.Done():
			return
		case <-q.wake:
		case <-ticker.C:
		}
	}
}

// claim atomically picks the next runnable job and marks it running.
func (q *Queue) claim(ctx context.Context) (Job, bool) {
	tx, err := q.DB.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, false
	}
	defer tx.Rollback()

	var j Job
	err = tx.QueryRowContext(ctx, `
		SELECT id, kind, source, attempts FROM jobs
		WHERE status = 'queued' AND next_attempt_at <= ?
		ORDER BY created_at LIMIT 1`, nowText()).Scan(&j.ID, &j.Kind, &j.source, &j.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return Job{}, false
	}
	if err != nil {
		return Job{}, false
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?`, nowText(), j.ID); err != nil {
		return Job{}, false
	}
	if err := tx.Commit(); err != nil {
		return Job{}, false
	}
	return j, true
}

func (q *Queue) process(ctx context.Context, j Job) {
	source := j.source
	runner := importer.Importer{DB: q.DB, Store: q.Store, Media: q.Media, ThumbMaxEdge: q.ThumbSize}

	var owner string
	_ = q.DB.QueryRowContext(ctx, `SELECT owner FROM jobs WHERE id = ?`, j.ID).Scan(&owner)

	result, err := runner.Run(ctx, importer.Options{SourceDir: source, OwnerUsername: owner})
	if err != nil {
		q.fail(ctx, j, err)
		return
	}
	if _, err := q.DB.ExecContext(ctx, `
		UPDATE jobs SET status = 'succeeded', total = ?, imported = ?, duplicates = ?,
		    skipped = ?, errors = ?, error = '', updated_at = ? WHERE id = ?`,
		result.Scanned, result.Imported, result.Duplicates, result.Skipped, len(result.Errors),
		nowText(), j.ID); err != nil {
		q.Log.Warn("queue: finalize job failed", "job", j.ID, "err", err)
	}
	// Record which files failed, so the Activity view can show details. Strip the
	// internal staging path from messages so they read cleanly.
	_, _ = q.DB.ExecContext(ctx, `DELETE FROM job_errors WHERE job_id = ?`, j.ID)
	for _, fe := range result.Errors {
		msg := strings.ReplaceAll(fe.Err.Error(), source+string(os.PathSeparator), "")
		_, _ = q.DB.ExecContext(ctx,
			`INSERT INTO job_errors (job_id, filename, error) VALUES (?, ?, ?)`,
			j.ID, filepath.Base(fe.Path), msg)
	}
	os.RemoveAll(source)
	if result.Imported > 0 {
		if err := stacks.Detect(ctx, q.DB); err != nil {
			q.Log.Warn("stack detection failed", "err", err)
		}
	}
	q.Log.Info("import job done", "job", j.ID, "imported", result.Imported,
		"duplicates", result.Duplicates, "errors", len(result.Errors))
}

func (q *Queue) fail(ctx context.Context, j Job, cause error) {
	attempts := j.Attempts + 1
	var maxAttempts int
	_ = q.DB.QueryRowContext(ctx, `SELECT max_attempts FROM jobs WHERE id = ?`, j.ID).Scan(&maxAttempts)
	if maxAttempts == 0 {
		maxAttempts = 3
	}
	if attempts < maxAttempts {
		backoff := time.Duration(attempts) * 30 * time.Second
		next := time.Now().UTC().Add(backoff).Format(time.RFC3339Nano)
		_, _ = q.DB.ExecContext(ctx, `
			UPDATE jobs SET status = 'queued', attempts = ?, error = ?, next_attempt_at = ?, updated_at = ?
			WHERE id = ?`, attempts, cause.Error(), next, nowText(), j.ID)
		q.Log.Warn("import job failed, will retry", "job", j.ID, "attempt", attempts, "err", cause)
		return
	}
	_, _ = q.DB.ExecContext(ctx, `
		UPDATE jobs SET status = 'failed', attempts = ?, error = ?, updated_at = ? WHERE id = ?`,
		attempts, cause.Error(), nowText(), j.ID)
	os.RemoveAll(j.source)
	q.Log.Error("import job failed permanently", "job", j.ID, "err", cause)
}
