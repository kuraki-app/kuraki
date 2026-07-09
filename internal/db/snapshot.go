package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Snapshot writes a consistent copy of the database into snapshotsDir using
// SQLite's `VACUUM INTO`, which safely captures WAL contents (a naive file copy
// would not). Returns the snapshot path. This is the pre-migration backup that
// makes upgrades boring (F-11).
func Snapshot(ctx context.Context, db *sql.DB, snapshotsDir string) (string, error) {
	if err := os.MkdirAll(snapshotsDir, 0o755); err != nil {
		return "", err
	}
	name := "kuraki-" + time.Now().UTC().Format("20060102T150405Z") + ".db"
	dst := filepath.Join(snapshotsDir, name)

	// VACUUM INTO fails if the target exists; guard against a same-second retry.
	if _, err := os.Stat(dst); err == nil {
		return dst, nil
	}
	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", dst); err != nil {
		return "", fmt.Errorf("db: vacuum into %s: %w", dst, err)
	}
	return dst, nil
}
