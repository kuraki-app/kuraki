package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type albumRequest struct {
	Name string `json:"name"`
}

type albumDTO struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AssetCount int    `json:"asset_count"`
	CreatedAt  string `json:"created_at"`
}

// ownsAlbum verifies the album exists, is not deleted, and belongs to the caller.
func (d Deps) ownsAlbum(r *http.Request, albumID string) (bool, error) {
	user := d.currentUser(r)
	if user == nil {
		return false, nil
	}
	var one int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT 1 FROM albums WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		albumID, user.ID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (d Deps) createAlbum(w http.ResponseWriter, r *http.Request) {
	var req albumRequest
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
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "id_failed")
		return
	}
	if _, err := d.DB.ExecContext(r.Context(),
		`INSERT INTO albums (id, owner_id, name) VALUES (?, ?, ?)`,
		id.String(), user.ID, req.Name); err != nil {
		writeError(w, http.StatusInternalServerError, "create_album_failed")
		return
	}
	writeJSON(w, http.StatusCreated, albumDTO{ID: id.String(), Name: req.Name})
}

func (d Deps) listAlbums(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT al.id, al.name, al.created_at, COUNT(ast.id)
		FROM albums al
		LEFT JOIN album_assets aa ON aa.album_id = al.id
		LEFT JOIN assets ast ON ast.id = aa.asset_id AND ast.deleted_at IS NULL
		WHERE al.deleted_at IS NULL AND al.owner_id = ?
		GROUP BY al.id
		ORDER BY al.created_at DESC`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_albums_failed")
		return
	}
	defer rows.Close()
	albums := make([]albumDTO, 0)
	for rows.Next() {
		var a albumDTO
		if err := rows.Scan(&a.ID, &a.Name, &a.CreatedAt, &a.AssetCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_albums_failed")
			return
		}
		albums = append(albums, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": albums})
}

// getAlbum returns the album's assets (in timeline order).
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
	writeJSON(w, http.StatusOK, assetListResponse{Assets: assets, NextCursor: next})
}

func (d Deps) renameAlbum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req albumRequest
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
	writeJSON(w, http.StatusOK, albumDTO{ID: id, Name: req.Name})
}

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

func (d Deps) addAlbumAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsAlbum(r, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	var req zipRequest // {ids: [...]}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	added := 0
	for _, assetID := range req.IDs {
		res, err := d.DB.ExecContext(r.Context(), `
			INSERT OR IGNORE INTO album_assets (album_id, asset_id, position)
			VALUES (?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM album_assets WHERE album_id = ?))`,
			id, assetID, id)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				added++
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added})
}

func (d Deps) removeAlbumAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsAlbum(r, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "album_not_found")
		return
	}
	var req zipRequest
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
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed})
}
