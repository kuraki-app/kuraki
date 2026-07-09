// Package db opens Kuraki's SQLite database and applies versioned migrations.
//
// SQLite runs in WAL mode via the pure-Go modernc.org/sqlite driver, which
// keeps the database layer CGO-free and portable even though the media layer
// links libvips. Every migration is preceded by an automatic snapshot (F-11)
// so upgrades are "replace binary, restart" without fear.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"math"

	"github.com/pressly/goose/v3"
	"github.com/saranshh/kuraki/internal/db/migrations"

	_ "modernc.org/sqlite"
)

// Open returns a WAL-mode SQLite handle at path. Pragmas are set via the DSN so
// they apply to every connection in the pool.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	dsn := "file:" + path +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return db, nil
}

// Migrate applies all pending migrations, taking a pre-migration snapshot first
// when the database already exists and is behind the latest version (F-11).
// snapshotFn is called with no args and should copy the DB file aside; it is a
// closure so this package stays unaware of on-disk layout.
func Migrate(db *sql.DB, snapshotFn func() error) error {
	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("db: dialect: %w", err)
	}

	current, err := goose.GetDBVersion(db)
	if err != nil {
		return fmt.Errorf("db: get version: %w", err)
	}
	target, err := latestVersion()
	if err != nil {
		return fmt.Errorf("db: latest version: %w", err)
	}

	// Snapshot only when this is a real upgrade of an existing database,
	// not the first-run bootstrap (current == 0).
	if snapshotFn != nil && current > 0 && current < target {
		if err := snapshotFn(); err != nil {
			return fmt.Errorf("db: pre-migration snapshot: %w", err)
		}
	}

	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("db: migrate up: %w", err)
	}
	return nil
}

// latestVersion returns the highest migration version embedded in the binary.
func latestVersion() (int64, error) {
	migs, err := goose.CollectMigrations(".", 0, int64(math.MaxInt64))
	if err != nil {
		return 0, err
	}
	if len(migs) == 0 {
		return 0, nil
	}
	return migs[len(migs)-1].Version, nil
}
