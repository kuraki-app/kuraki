package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RecordCleanup belongs in the transaction that retires the referencing row.
func RecordCleanup(ctx context.Context, tx *sql.Tx, path string) error {
	if !strings.HasPrefix(path, "originals/") && !strings.HasPrefix(path, "trash/") && !strings.HasPrefix(path, "derivatives/") {
		return fmt.Errorf("storage: invalid cleanup path")
	}
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO storage_cleanup(path) VALUES (?)`, path)
	return err
}

// DrainCleanup requires the exclusive library lock. Intents survive until the
// backend acknowledges removal, including when a disk or process is unavailable.
func DrainCleanup(ctx context.Context, database *sql.DB, store Storage) error {
	rows, err := database.QueryContext(ctx, `SELECT path FROM storage_cleanup ORDER BY created_at LIMIT 1000`)
	if err != nil {
		return fmt.Errorf("storage: read pending cleanup: %w", err)
	}
	var paths []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			rows.Close()
			return err
		}
		paths = append(paths, path)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, path := range paths {
		if err := store.Remove(ctx, path); err != nil {
			return fmt.Errorf("storage: pending cleanup: %w", err)
		}
		if _, err := database.ExecContext(ctx, `DELETE FROM storage_cleanup WHERE path=?`, path); err != nil {
			return err
		}
	}
	return nil
}
