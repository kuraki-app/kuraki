package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// ownsAlbum verifies the album exists, is not deleted, and belongs to the caller.
func (d Deps) ownsAlbum(r *http.Request, albumID string) (bool, error) {
	owner, ok := d.ownerID(r)
	if !ok {
		return false, nil
	}
	var one int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT 1 FROM albums WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		albumID, owner).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ownsAsset reports whether the authenticated owner owns the asset (any state).
// Used to scope the device-reachable trash writes so a token can't delete/
// restore/purge another owner's asset.
func (d Deps) ownsAsset(r *http.Request, assetID string) (bool, error) {
	owner, ok := d.ownerID(r)
	if !ok {
		return false, nil
	}
	return d.ownsAssetCtx(r.Context(), owner, assetID)
}

// ownsAssetCtx is the context-only variant of ownsAsset, for call sites (like
// the batch endpoint) that already have the owner resolved and don't have an
// *http.Request to hand in.
func (d Deps) ownsAssetCtx(ctx context.Context, owner, assetID string) (bool, error) {
	var one int
	err := d.DB.QueryRowContext(ctx,
		`SELECT 1 FROM assets WHERE id = ? AND owner_id = ?`, assetID, owner).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// @Summary Create album
// @Tags    albums
// @Accept  json
// @Produce json
// @Param   body body apitypes.AlbumRequest true "album name"
// @Success 201 {object} apitypes.Album
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/albums [post]
func (d Deps) createAlbum(w http.ResponseWriter, r *http.Request) {
	var req apitypes.AlbumRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name_required")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "id_failed")
		return
	}
	if _, err := d.DB.ExecContext(r.Context(),
		`INSERT INTO albums (id, owner_id, name) VALUES (?, ?, ?)`,
		id.String(), owner, req.Name); err != nil {
		writeError(w, http.StatusInternalServerError, "create_album_failed")
		return
	}
	writeJSON(w, http.StatusCreated, apitypes.Album{ID: id.String(), Name: req.Name})
}

// @Summary List albums
// @Tags    albums
// @Produce json
// @Success 200 {object} apitypes.AlbumList
// @Failure 401 {object} apitypes.Error
// @Router  /api/albums [get]
func (d Deps) listAlbums(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT al.id, al.name, al.created_at, COUNT(ast.id)
		FROM albums al
		LEFT JOIN album_assets aa ON aa.album_id = al.id
		LEFT JOIN assets ast ON ast.id = aa.asset_id AND ast.deleted_at IS NULL
		WHERE al.deleted_at IS NULL AND al.owner_id = ?
		GROUP BY al.id
		ORDER BY al.created_at DESC`, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_albums_failed")
		return
	}
	defer rows.Close()
	albums := make([]apitypes.Album, 0)
	for rows.Next() {
		var a apitypes.Album
		if err := rows.Scan(&a.ID, &a.Name, &a.CreatedAt, &a.AssetCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_albums_failed")
			return
		}
		albums = append(albums, a)
	}
	writeJSON(w, http.StatusOK, apitypes.AlbumList{Albums: albums})
}

// getAlbum returns the album's assets (in timeline order).
// @Summary Get album assets
// @Tags    albums
// @Produce json
// @Param   id     path  string true  "album id"
// @Param   cursor query string false "pagination cursor"
// @Param   limit  query int    false "page size"
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/albums/{id} [get]
func (d Deps) getAlbum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsAlbum(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "album_lookup_failed")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	limit := parseLimit(r.URL.Query().Get("limit"))
	cursor, cursorArgs, cok := requestCursor(w, r)
	if !cok {
		return
	}
	args := append([]any{id}, cursorArgs...)
	args = append(args, limit+1)
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQLWithJoin("JOIN album_assets aa ON aa.asset_id = a.id",
			"WHERE aa.album_id = ? AND a.deleted_at IS NULL"+cursor)+" LIMIT ?", args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_album_assets_failed")
		return
	}
	defer rows.Close()
	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_album_assets_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}

// @Summary Rename album
// @Tags    albums
// @Accept  json
// @Produce json
// @Param   id   path string             true "album id"
// @Param   body body apitypes.AlbumRequest true "new name"
// @Success 200 {object} apitypes.Album
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/albums/{id} [patch]
func (d Deps) renameAlbum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req apitypes.AlbumRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name_required")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE albums SET name = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		req.Name, id, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rename_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.Album{ID: id, Name: req.Name})
}

// @Summary Delete album
// @Tags    albums
// @Produce json
// @Param   id path string true "album id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/albums/{id} [delete]
func (d Deps) deleteAlbum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE albums SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, id, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "delete_album_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// @Summary Add assets to album
// @Tags    albums
// @Accept  json
// @Produce json
// @Param   id   path string            true "album id"
// @Param   body body apitypes.AssetIDs true "asset ids"
// @Success 200 {object} map[string]int
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/albums/{id}/assets [post]
func (d Deps) addAlbumAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsAlbum(r, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.AssetIDs
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	// The same ceiling /api/assets/batch and /api/assets/zip enforce. These two
	// endpoints had none, which stopped being theoretical when the clients grew
	// a Select all and an add-photos picker: one tap can now offer every id in
	// the library.
	if len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "too_many_ids")
		return
	}

	added, err := d.linkAlbumAssets(r.Context(), id, owner, req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "album_add_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added})
}

// @Summary Remove assets from album
// @Tags    albums
// @Accept  json
// @Produce json
// @Param   id   path string            true "album id"
// @Param   body body apitypes.AssetIDs true "asset ids"
// @Success 200 {object} map[string]int
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/albums/{id}/assets [delete]
func (d Deps) removeAlbumAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsAlbum(r, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.AssetIDs
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "too_many_ids")
		return
	}

	removed, err := d.unlinkAlbumAssets(r.Context(), id, owner, req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "album_remove_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed})
}

/*
 * Album membership writes run in one transaction.
 *
 * Both used to loop `d.DB.ExecContext` per asset, so every row was its own
 * implicit transaction -- and each linked row wrote a change_log entry in a
 * second one. Adding 500 photos meant a thousand transactions and a thousand
 * WAL commits for what is one user action, and a failure halfway left the album
 * holding an arbitrary prefix of the selection with no way to tell.
 *
 * One transaction makes the whole operation atomic and commits once. The
 * prepared statements matter as much as the transaction: the same two queries
 * run per id, so parsing them once rather than per row is most of what is left.
 */

func (d Deps) linkAlbumAssets(ctx context.Context, albumID, owner string, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("httpapi: begin album add: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	// The EXISTS guard is the owner scope: this is a write a device token can
	// make, and without it any asset id could be linked into another owner's
	// album.
	insert, err := tx.PrepareContext(ctx, `
		INSERT OR IGNORE INTO album_assets (album_id, asset_id, position)
		SELECT ?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM album_assets WHERE album_id = ?)
		WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND owner_id = ?)`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare album add: %w", err)
	}
	defer insert.Close()

	logChange, err := tx.PrepareContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', ?)`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare album add log: %w", err)
	}
	defer logChange.Close()

	added := 0
	for _, assetID := range ids {
		res, err := insert.ExecContext(ctx, albumID, assetID, albumID, assetID, owner)
		if err != nil {
			return 0, fmt.Errorf("httpapi: album add: %w", err)
		}
		// Only a row that actually landed counts, and only it is worth a
		// change_log entry -- re-adding something already in the album is a
		// no-op that must not wake every device's delta sync.
		if n, _ := res.RowsAffected(); n > 0 {
			added++
			if _, err := logChange.ExecContext(ctx, assetID, owner); err != nil {
				return 0, fmt.Errorf("httpapi: album add log: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("httpapi: commit album add: %w", err)
	}
	return added, nil
}

func (d Deps) unlinkAlbumAssets(ctx context.Context, albumID, owner string, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("httpapi: begin album remove: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	del, err := tx.PrepareContext(ctx, `DELETE FROM album_assets WHERE album_id = ? AND asset_id = ?`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare album remove: %w", err)
	}
	defer del.Close()

	logChange, err := tx.PrepareContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', ?)`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare album remove log: %w", err)
	}
	defer logChange.Close()

	removed := 0
	for _, assetID := range ids {
		res, err := del.ExecContext(ctx, albumID, assetID)
		if err != nil {
			return 0, fmt.Errorf("httpapi: album remove: %w", err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			removed++
			if _, err := logChange.ExecContext(ctx, assetID, owner); err != nil {
				return 0, fmt.Errorf("httpapi: album remove log: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("httpapi: commit album remove: %w", err)
	}
	return removed, nil
}
