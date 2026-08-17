// Package trash implements soft deletion with a retention window (F-10).
//
// Deleting an asset moves its original from originals/ to trash/ (mirroring the
// relative path) and stamps assets.deleted_at. Restore reverses it. PurgeExpired
// permanently removes assets whose retention window has elapsed. Physical file
// access goes through storage.Storage so this works for any backend.
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

// Retention is how long a trashed asset is restorable before purge (F-10).
const Retention = 30 * 24 * time.Hour

var (
	ErrNotFound       = errors.New("trash: asset not found")
	ErrAlreadyDeleted = errors.New("trash: asset already deleted")
	ErrNotDeleted     = errors.New("trash: asset is not in trash")
)

func nowText() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// Delete soft-deletes an asset: original → trash/, deleted_at stamped.
func Delete(ctx context.Context, db *sql.DB, store storage.Storage, assetID string) error {
	var path string
	var deletedAt sql.NullString
	var owner string
	err := db.QueryRowContext(ctx,
		`SELECT original_path, deleted_at, owner_id FROM assets WHERE id = ?`, assetID).Scan(&path, &deletedAt, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("trash: lookup asset: %w", err)
	}
	if deletedAt.Valid {
		return ErrAlreadyDeleted
	}

	if err := store.Move(ctx, "originals/"+path, "trash/"+path); err != nil {
		return fmt.Errorf("trash: move original to trash: %w", err)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE assets SET deleted_at = ? WHERE id = ?`, nowText(), assetID); err != nil {
		// Roll the file back so DB and disk stay consistent.
		_ = store.Move(ctx, "trash/"+path, "originals/"+path)
		return fmt.Errorf("trash: mark deleted: %w", err)
	}
	_, _ = db.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'delete', ?)`, assetID, owner)
	return nil
}

// Restore reverses a soft delete: trash/ → original, deleted_at cleared.
func Restore(ctx context.Context, db *sql.DB, store storage.Storage, assetID string) error {
	var path string
	var deletedAt sql.NullString
	var owner string
	err := db.QueryRowContext(ctx,
		`SELECT original_path, deleted_at, owner_id FROM assets WHERE id = ?`, assetID).Scan(&path, &deletedAt, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("trash: lookup asset: %w", err)
	}
	if !deletedAt.Valid {
		return ErrNotDeleted
	}

	if err := store.Move(ctx, "trash/"+path, "originals/"+path); err != nil {
		return fmt.Errorf("trash: move original from trash: %w", err)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE assets SET deleted_at = NULL WHERE id = ?`, assetID); err != nil {
		_ = store.Move(ctx, "originals/"+path, "trash/"+path)
		return fmt.Errorf("trash: clear deleted: %w", err)
	}
	_, _ = db.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', ?)`, assetID, owner)
	return nil
}

// Purge permanently deletes one trashed asset (originals, derivatives, row).
// It refuses an asset that is not currently in the trash.
func Purge(ctx context.Context, db *sql.DB, store storage.Storage, assetID string) error {
	var path string
	var deletedAt sql.NullString
	var owner string
	err := db.QueryRowContext(ctx,
		`SELECT original_path, deleted_at, owner_id FROM assets WHERE id = ?`, assetID).Scan(&path, &deletedAt, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("trash: lookup asset: %w", err)
	}
	if !deletedAt.Valid {
		return ErrNotDeleted
	}
	return purgeOne(ctx, db, store, assetID, path, owner)
}

// PurgeExpired permanently removes assets deleted before cutoff: trash file,
// derivative files + rows (via FK cascade), FTS row, and the asset row. Returns
// the number of assets purged.
func PurgeExpired(ctx context.Context, db *sql.DB, store storage.Storage, cutoff time.Time) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, original_path, owner_id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
		cutoff.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("trash: query expired: %w", err)
	}
	type target struct{ id, path, owner string }
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.path, &t.owner); err != nil {
			rows.Close()
			return 0, fmt.Errorf("trash: scan expired: %w", err)
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	purged := 0
	for _, t := range targets {
		if err := purgeOne(ctx, db, store, t.id, t.path, t.owner); err != nil {
			return purged, err
		}
		purged++
	}
	return purged, nil
}

func purgeOne(ctx context.Context, db *sql.DB, store storage.Storage, id, path, owner string) error {
	// Remove derivative files first (we need their paths before rows vanish).
	drows, err := db.QueryContext(ctx, `SELECT path FROM derivatives WHERE asset_id = ?`, id)
	if err != nil {
		return fmt.Errorf("trash: query derivatives: %w", err)
	}
	var derivPaths []string
	for drows.Next() {
		var p string
		if err := drows.Scan(&p); err != nil {
			drows.Close()
			return err
		}
		derivPaths = append(derivPaths, p)
	}
	drows.Close()

	_ = store.Remove(ctx, "trash/"+path)
	for _, p := range derivPaths {
		_ = store.Remove(ctx, "derivatives/"+p)
	}

	// Deleting the asset row cascades derivatives + album_assets (FK ON DELETE
	// CASCADE); FTS is standalone so remove it explicitly.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fts.Delete(ctx, tx, id); err != nil {
		return fmt.Errorf("trash: delete fts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM assets WHERE id = ?`, id); err != nil {
		return fmt.Errorf("trash: delete asset: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'delete', ?)`, id, owner); err != nil {
		return fmt.Errorf("trash: change log: %w", err)
	}
	return tx.Commit()
}
