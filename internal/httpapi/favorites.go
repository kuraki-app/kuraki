package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type favoriteRequest struct {
	Favorite bool `json:"favorite"`
}

// setFavorite marks or unmarks an asset as a favorite.
func (d Deps) setFavorite(w http.ResponseWriter, r *http.Request) {
	var req favoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	fav := 0
	if req.Favorite {
		fav = 1
	}
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE assets SET favorite = ? WHERE id = ? AND deleted_at IS NULL`,
		fav, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "favorite_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"favorite": req.Favorite})
}

// listFavorites returns the favorites feed (F-08 favorites user story).
func (d Deps) listFavorites(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"))
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL("WHERE a.favorite = 1 AND a.deleted_at IS NULL")+" LIMIT ?", limit+1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_favorites_failed")
		return
	}
	defer rows.Close()
	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_favorites_failed")
		return
	}
	writeJSON(w, http.StatusOK, assetListResponse{Assets: assets, NextCursor: next})
}
