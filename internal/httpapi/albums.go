package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
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
	var one int
	err := d.DB.QueryRowContext(r.Context(),
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
// @Router  /api/capture/albums [post]
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
// @Router  /api/capture/albums [get]
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
// @Router  /api/capture/albums/{id} [get]
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
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQLWithJoin("JOIN album_assets aa ON aa.asset_id = a.id",
			"WHERE aa.album_id = ? AND a.deleted_at IS NULL")+" LIMIT ?", id, limit+1)
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
	user := d.currentUser(r)
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE albums SET name = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		req.Name, id, user.ID)
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
	user := d.currentUser(r)
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE albums SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, id, user.ID)
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
// @Router  /api/capture/albums/{id}/assets [post]
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
	added := 0
	for _, assetID := range req.IDs {
		// Only link the asset when it exists and is owned by the caller — this
		// is the one device write that wasn't owner-scoped (favorite + all
		// trash writes already are), so without the EXISTS guard any asset_id
		// could be linked into another owner's album.
		res, err := d.DB.ExecContext(r.Context(), `
			INSERT OR IGNORE INTO album_assets (album_id, asset_id, position)
			SELECT ?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM album_assets WHERE album_id = ?)
			WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND owner_id = ?)`,
			id, assetID, id, assetID, owner)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				added++
				d.logAssetChange(r.Context(), assetID, owner, "update")
			}
		}
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
// @Router  /api/capture/albums/{id}/assets [delete]
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
	removed := 0
	for _, assetID := range req.IDs {
		res, err := d.DB.ExecContext(r.Context(),
			`DELETE FROM album_assets WHERE album_id = ? AND asset_id = ?`, id, assetID)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				removed++
				d.logAssetChange(r.Context(), assetID, owner, "update")
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed})
}
