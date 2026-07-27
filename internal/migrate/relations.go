package migrate

import (
	"context"
	"errors"
	"fmt"

	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/trash"
)

// applyRelations attaches one imported asset to everything the source said it
// belonged to: albums, tags, a stack, and the trash.
//
// Every write is idempotent, because a re-run of a migration replays these for
// assets that already exist.
func (e *Engine) applyRelations(ctx context.Context, ownerID string, ia importer.ImportedAsset, item Item, albums, tags map[string]string) error {
	var changed bool
	var firstErr error
	note := func(did bool, err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
		changed = changed || did
	}

	for _, sourceAlbumID := range item.AlbumIDs {
		localAlbumID, ok := albums[sourceAlbumID]
		if !ok {
			continue
		}
		note(e.addToAlbum(ctx, ownerID, localAlbumID, ia.AssetID))
	}

	for _, sourceTagID := range item.TagIDs {
		localTagID, ok := tags[sourceTagID]
		if !ok {
			continue
		}
		note(e.addTag(ctx, ownerID, localTagID, ia.AssetID))
	}

	if item.StackID != "" {
		note(e.setStackPlaceholder(ctx, ia.AssetID, item.StackID, item.StackPrimary))
	}

	if item.Trashed {
		if err := trash.Delete(ctx, e.DB, e.Store, ia.AssetID); err != nil &&
			!errors.Is(err, trash.ErrAlreadyDeleted) {
			if firstErr == nil {
				firstErr = fmt.Errorf("migrate: trash asset: %w", err)
			}
		}
	}

	// A freshly imported asset already has a 'create' entry in change_log, which
	// tells a syncing client to fetch it whole — albums and tags included. Only
	// an asset that already existed needs an extra 'update' to be re-fetched, so
	// a large migration does not double the change log for nothing.
	if changed && ia.Duplicate {
		_, _ = e.DB.ExecContext(ctx,
			`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', ?)`,
			ia.AssetID, ownerID)
	}
	return firstErr
}

// addToAlbum links an asset into an album, appending at the end. The EXISTS
// guard mirrors the HTTP handler: only the owner's own assets can be linked.
func (e *Engine) addToAlbum(ctx context.Context, ownerID, albumID, assetID string) (bool, error) {
	res, err := e.DB.ExecContext(ctx, `
		INSERT OR IGNORE INTO album_assets (album_id, asset_id, position)
		SELECT ?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM album_assets WHERE album_id = ?)
		WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND owner_id = ?)`,
		albumID, assetID, albumID, assetID, ownerID)
	if err != nil {
		return false, fmt.Errorf("migrate: add to album: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (e *Engine) addTag(ctx context.Context, ownerID, tagID, assetID string) (bool, error) {
	res, err := e.DB.ExecContext(ctx, `
		INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
		SELECT ?, id FROM tags WHERE id = ? AND owner_id = ?`,
		assetID, tagID, ownerID)
	if err != nil {
		return false, fmt.Errorf("migrate: add tag: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// setStackPlaceholder records stack membership using the source's stack key.
//
// Kuraki's convention is that members share the primary's asset id as stack_id,
// but the primary may not have been imported yet when a member lands. Writing
// the source key first and rewriting it in finalizeStacks lets members arrive in
// any order, and survives an interrupted run because the state is in the assets
// table rather than in memory.
func (e *Engine) setStackPlaceholder(ctx context.Context, assetID, sourceStackID string, primary bool) (bool, error) {
	res, err := e.DB.ExecContext(ctx,
		`UPDATE assets SET stack_id = ?, stack_primary = ?, stack_locked = 1 WHERE id = ?`,
		stackPlaceholder(sourceStackID), boolInt(primary), assetID)
	if err != nil {
		return false, fmt.Errorf("migrate: set stack: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// stackPlaceholder namespaces a source stack key so finalizeStacks can find it
// and no native stack_id (always a UUID) can collide with it.
func stackPlaceholder(sourceStackID string) string {
	return "migrate:" + sourceStackID
}

// finalizeStacks rewrites placeholder stack ids to the real convention: every
// member carries the primary's asset id, and exactly one member is the primary.
// Stacks that ended up with a single member are dissolved — that is what
// happens to the videos speculatively grouped as possible live-photo halves.
func (e *Engine) finalizeStacks(ctx context.Context, ownerID string) error {
	rows, err := e.DB.QueryContext(ctx, `
		SELECT stack_id FROM assets
		WHERE owner_id = ? AND stack_id LIKE 'migrate:%'
		GROUP BY stack_id`, ownerID)
	if err != nil {
		return fmt.Errorf("migrate: list pending stacks: %w", err)
	}
	placeholders := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("migrate: scan pending stack: %w", err)
		}
		placeholders = append(placeholders, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, placeholder := range placeholders {
		if err := e.finalizeOneStack(ctx, ownerID, placeholder); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) finalizeOneStack(ctx context.Context, ownerID, placeholder string) error {
	rows, err := e.DB.QueryContext(ctx, `
		SELECT id, stack_primary FROM assets
		WHERE owner_id = ? AND stack_id = ?
		ORDER BY stack_primary DESC, COALESCE(taken_at, created_at), id`,
		ownerID, placeholder)
	if err != nil {
		return fmt.Errorf("migrate: load stack members: %w", err)
	}
	type member struct {
		id      string
		primary bool
	}
	members := make([]member, 0, 2)
	for rows.Next() {
		var m member
		var isPrimary int
		if err := rows.Scan(&m.id, &isPrimary); err != nil {
			rows.Close()
			return fmt.Errorf("migrate: scan stack member: %w", err)
		}
		m.primary = isPrimary != 0
		members = append(members, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(members) < 2 {
		// Not a stack at all — clear it, and unlock so ordinary filename
		// detection may still pair it with something later.
		_, err := e.DB.ExecContext(ctx,
			`UPDATE assets SET stack_id = NULL, stack_primary = 1, stack_locked = 0
			 WHERE owner_id = ? AND stack_id = ?`,
			ownerID, placeholder)
		if err != nil {
			return fmt.Errorf("migrate: dissolve stack: %w", err)
		}
		return nil
	}

	// The ORDER BY already put a declared primary first; otherwise the earliest
	// capture leads, matching how stacks.Detect picks a representative.
	primaryID := members[0].id

	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrate: begin stack finalize: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET stack_id = ?, stack_primary = 0 WHERE owner_id = ? AND stack_id = ?`,
		primaryID, ownerID, placeholder); err != nil {
		return fmt.Errorf("migrate: rewrite stack id: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET stack_primary = 1 WHERE id = ?`, primaryID); err != nil {
		return fmt.Errorf("migrate: set stack primary: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migrate: commit stack finalize: %w", err)
	}
	return nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
