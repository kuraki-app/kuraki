// Package maintenance owns Kuraki's recurring housekeeping. The application
// composition root starts one Manager; scheduling, due checks, retention and
// cleanup details remain behind that single seam.
package maintenance

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/kuraki-app/kuraki/internal/backup"
	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/kuraki-app/kuraki/internal/trash"
	"github.com/kuraki-app/kuraki/internal/verify"
)

const (
	daily             = 24 * time.Hour
	integrityInterval = 7 * daily
)

// Manager coordinates scheduled maintenance against one library.
type Manager struct {
	db       *sql.DB
	store    storage.Storage
	settings *config.Store
	log      *slog.Logger
}

// New returns a maintenance manager for one assembled application.
func New(db *sql.DB, store storage.Storage, settings *config.Store, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{db: db, store: store, settings: settings, log: log}
}

// Start performs the cheap startup sweeps and launches all recurring work.
// Every goroutine exits when ctx is cancelled.
func (m *Manager) Start(ctx context.Context) {
	m.startTrashJanitor(ctx)
	m.startChangeLogJanitor(ctx)
	m.startCaptureJanitor(ctx)
	m.startIntegrityScheduler(ctx)
	m.startBackupScheduler(ctx)
}

// PurgeTrash permanently removes assets whose retention window has elapsed.
func (m *Manager) PurgeTrash(ctx context.Context) (int, error) {
	days := m.settings.Current().TrashRetentionDays
	if days <= 0 {
		days = 30
	}
	return trash.PurgeExpired(ctx, m.db, m.store, time.Now().AddDate(0, 0, -days))
}

// PruneChangeLog keeps only the newest configured number of change rows. A
// client below the retained floor is explicitly told to perform a full sync.
func (m *Manager) PruneChangeLog(ctx context.Context) (int64, error) {
	keep := m.settings.Current().ChangeLogKeep
	if keep <= 0 {
		keep = 100000
	}
	res, err := m.db.ExecContext(ctx, `
		DELETE FROM change_log
		WHERE id < (SELECT MIN(id) FROM (SELECT id FROM change_log ORDER BY id DESC LIMIT ?))`, keep)
	if err != nil {
		return 0, fmt.Errorf("maintenance: prune change_log: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (m *Manager) startIntegrityScheduler(ctx context.Context) {
	due := func() bool {
		last, ok, err := verify.LastRun(ctx, m.db)
		if err != nil || !ok || last.FinishedAt == "" {
			return true
		}
		t, err := time.Parse(time.RFC3339Nano, last.FinishedAt)
		return err != nil || time.Since(t) >= integrityInterval
	}
	run := func() {
		result, err := verify.RunAndRecord(ctx, m.db, m.store)
		if err != nil {
			m.log.Warn("integrity verification failed", "err", err)
			return
		}
		m.log.Info("integrity verification complete", "checked", result.Checked, "problems", len(result.Problems))
	}
	go delayedLoop(ctx, 30*time.Second, daily, func() {
		if due() {
			run()
		}
	})
}

func (m *Manager) startBackupScheduler(ctx context.Context) {
	booted := m.settings.Booted()
	if booted.BackupDir == "" {
		return
	}
	hours := booted.BackupIntervalHours
	if hours <= 0 {
		hours = 24
	}
	interval := time.Duration(hours) * time.Hour
	due := func() bool {
		last, ok, err := backup.LastRun(ctx, m.db)
		if err != nil || !ok || last.FinishedAt == "" {
			return true
		}
		t, err := time.Parse(time.RFC3339Nano, last.FinishedAt)
		return err != nil || time.Since(t) >= interval
	}
	run := func() {
		summary, err := backup.RunAndRecord(ctx, m.db, booted.DataDir, booted.BackupDir)
		if err != nil {
			m.log.Warn("automatic backup failed", "err", err)
			return
		}
		m.log.Info("automatic backup complete", "dest", summary.Destination, "bytes", summary.Bytes)
		if err := backup.Prune(booted.BackupDir, booted.BackupKeep); err != nil {
			m.log.Warn("backup prune failed", "err", err)
		}
	}
	go delayedLoop(ctx, 45*time.Second, interval, func() {
		if due() {
			run()
		}
	})
}

func (m *Manager) startTrashJanitor(ctx context.Context) {
	run := func() {
		n, err := m.PurgeTrash(ctx)
		if err != nil {
			m.log.Warn("trash purge failed", "err", err)
			return
		}
		if n > 0 {
			m.log.Info("purged expired trash", "count", n)
		}
	}
	run()
	go repeat(ctx, daily, run)
}

func (m *Manager) startChangeLogJanitor(ctx context.Context) {
	run := func() {
		n, err := m.PruneChangeLog(ctx)
		if err != nil {
			m.log.Warn("change_log prune failed", "err", err)
			return
		}
		if n > 0 {
			m.log.Info("pruned change_log", "count", n)
		}
	}
	run()
	go repeat(ctx, daily, run)
}

func (m *Manager) startCaptureJanitor(ctx context.Context) {
	run := func() {
		n, err := m.purgeExpiredCaptures(ctx)
		if err != nil {
			m.log.Warn("capture purge failed", "err", err)
			return
		}
		if n > 0 {
			m.log.Info("purged expired capture sessions", "count", n)
		}
		if _, err := m.db.ExecContext(ctx, `DELETE FROM pairing_codes WHERE expires_at < ?`, nowText()); err != nil {
			m.log.Warn("pairing code purge failed", "err", err)
		}
	}
	run()
	go repeat(ctx, time.Hour, run)
}

func (m *Manager) purgeExpiredCaptures(ctx context.Context) (int, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, source_dir FROM upload_sessions
		WHERE status = 'receiving' AND expires_at < ?`, nowText())
	if err != nil {
		return 0, fmt.Errorf("maintenance: query expired captures: %w", err)
	}
	defer rows.Close()
	type expired struct{ id, dir string }
	var stale []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.dir); err != nil {
			return 0, fmt.Errorf("maintenance: scan expired capture: %w", err)
		}
		stale = append(stale, e)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("maintenance: iterate expired captures: %w", err)
	}
	n := 0
	for _, e := range stale {
		if err := os.RemoveAll(e.dir); err != nil {
			m.log.Warn("capture staging cleanup failed", "session", e.id, "err", err)
			continue
		}
		if _, err := m.db.ExecContext(ctx, `DELETE FROM upload_sessions WHERE id = ? AND status = 'receiving'`, e.id); err != nil {
			m.log.Warn("capture session delete failed", "session", e.id, "err", err)
			continue
		}
		n++
	}
	return n, nil
}

func delayedLoop(ctx context.Context, delay, interval time.Duration, run func()) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(delay):
	}
	run()
	repeat(ctx, interval, run)
}

func repeat(ctx context.Context, interval time.Duration, run func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }
