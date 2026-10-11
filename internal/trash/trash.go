// Package trash implements catalog soft deletion and recoverable permanent
// removal. Originals keep immutable paths; older move-based layouts reconcile.
package trash

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/kuraki-app/kuraki/internal/fts"
	"github.com/kuraki-app/kuraki/internal/storage"
)

const Retention = 30 * 24 * time.Hour

var (
	ErrNotFound       = errors.New("trash: asset not found")
	ErrAlreadyDeleted = errors.New("trash: asset already deleted")
	ErrNotDeleted     = errors.New("trash: asset is not in trash")
)

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func Delete(ctx context.Context, database *sql.DB, store storage.Storage, assetID string) error {
	return setDeleted(ctx, database, store, assetID, true)
}

func Restore(ctx context.Context, database *sql.DB, store storage.Storage, assetID string) error {
	return setDeleted(ctx, database, store, assetID, false)
}

func setDeleted(ctx context.Context, database *sql.DB, store storage.Storage, id string, deleting bool) error {
	unlock, err := storage.LockLibrary(ctx, store, false)
	if err != nil {
		return err
	}
	defer func() {
		if unlock != nil {
			_ = unlock()
		}
	}()
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Serialize catalog transitions without blocking concurrent read snapshots.
	if _, err := tx.ExecContext(ctx, `UPDATE assets SET deleted_at=deleted_at WHERE id=?`, id); err != nil {
		return err
	}
	var path, owner string
	var deleted, external sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT original_path, owner_id, deleted_at, external_path FROM assets WHERE id=?`, id).Scan(&path, &owner, &deleted, &external); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("trash: lookup asset: %w", err)
	}
	if deleting == deleted.Valid {
		if deleting {
			return ErrAlreadyDeleted
		}
		return ErrNotDeleted
	}
	if !deleting && !external.Valid {
		original, err := store.Exists(ctx, "originals/"+path)
		if err != nil {
			return err
		}
		legacy, err := store.Exists(ctx, "trash/"+path)
		if err != nil {
			return err
		}
		if !original && legacy {
			tx.Rollback()
			_ = unlock()
			unlock = nil
			if err := Reconcile(ctx, database, store); err != nil {
				return err
			}
			return setDeleted(ctx, database, store, id, deleting)
		}
	}
	var value any
	op := "update"
	if deleting {
		value, op = nowText(), "delete"
	}
	if _, err := tx.ExecContext(ctx, `UPDATE assets SET deleted_at=? WHERE id=?`, value, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_log(entity,entity_id,op,owner_id) VALUES ('asset',?,?,?)`, id, op, owner); err != nil {
		return err
	}
	return tx.Commit()
}

func recoverLegacyOriginal(ctx context.Context, store storage.Storage, path string) error {
	if exists, err := store.Exists(ctx, "originals/"+path); err != nil || exists {
		return err
	}
	if exists, err := store.Exists(ctx, "trash/"+path); err != nil {
		return err
	} else if !exists {
		return nil
	}
	if err := store.Move(ctx, "trash/"+path, "originals/"+path); err != nil {
		return fmt.Errorf("trash: recover legacy original: %w", err)
	}
	return nil
}

// Reconcile repairs interrupted older moves and resumes committed file cleanup.
func Reconcile(ctx context.Context, database *sql.DB, store storage.Storage) error {
	unlock, err := storage.LockLibrary(ctx, store, true)
	if err != nil {
		return err
	}
	defer unlock()
	var paths []string
	if lister, ok := store.(storage.LegacyTrashLister); ok {
		paths, err = lister.LegacyTrashPaths(ctx)
		if err != nil {
			return err
		}
	} else {
		rows, err := database.QueryContext(ctx, `SELECT original_path FROM assets WHERE external_path IS NULL`)
		if err != nil {
			return err
		}
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
	}
	for _, path := range paths {
		var references int
		if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets WHERE original_path=? AND external_path IS NULL`, path).Scan(&references); err != nil {
			return err
		}
		if references == 0 {
			continue
		}
		if err := recoverLegacyOriginal(ctx, store, path); err != nil {
			return err
		}
	}
	return storage.DrainCleanup(ctx, database, store)
}

func Purge(ctx context.Context, database *sql.DB, store storage.Storage, assetID string) error {
	_, err := purgeOne(ctx, database, store, assetID, nil)
	return err
}

func PurgeExpired(ctx context.Context, database *sql.DB, store storage.Storage, cutoff time.Time) (int, error) {
	rows, err := database.QueryContext(ctx, `SELECT id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("trash: query expired: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		removed, err := purgeOne(ctx, database, store, id, &cutoff)
		if err != nil {
			return n, err
		}
		if removed {
			n++
		}
	}
	return n, nil
}

func purgeOne(ctx context.Context, database *sql.DB, store storage.Storage, id string, cutoff *time.Time) (bool, error) {
	unlock, err := storage.LockLibrary(ctx, store, true)
	if err != nil {
		return false, err
	}
	defer unlock()
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var path, owner string
	var deleted, external sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT original_path,owner_id,deleted_at,external_path FROM assets WHERE id=?`, id).Scan(&path, &owner, &deleted, &external)
	if errors.Is(err, sql.ErrNoRows) {
		if cutoff != nil {
			return false, nil
		}
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if !deleted.Valid {
		if cutoff != nil {
			return false, nil
		}
		return false, ErrNotDeleted
	}
	if cutoff != nil {
		deletedAt, err := time.Parse(time.RFC3339Nano, deleted.String)
		if err != nil {
			return false, err
		}
		if !deletedAt.Before(*cutoff) {
			return false, nil
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT path FROM derivatives WHERE asset_id=? UNION SELECT path FROM thumb_variants WHERE asset_id=?`, id, id)
	if err != nil {
		return false, err
	}
	var paths []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			rows.Close()
			return false, err
		}
		paths = append(paths, "derivatives/"+path)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	if !external.Valid {
		paths = append(paths, "originals/"+path, "trash/"+path)
	}
	for _, path := range paths {
		if err := storage.RecordCleanup(ctx, tx, path); err != nil {
			return false, err
		}
	}
	if err := fts.Delete(ctx, tx, id); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM assets WHERE id=? AND deleted_at IS NOT NULL`, id); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_log(entity,entity_id,op,owner_id) VALUES ('asset',?,'delete',?)`, id, owner); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	if err := storage.DrainCleanup(ctx, database, store); err != nil {
		return true, fmt.Errorf("trash: cleanup pending: %w", err)
	}
	return true, nil
}
