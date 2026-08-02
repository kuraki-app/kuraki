package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// setFavorite marks or unmarks an asset as a favorite. It runs under both
// session (web) and device-token (mobile) auth via ownerID, and scopes the
// write to the caller's own assets so a device token can never flip favorite
// on another tenant's asset once multi-user unparks.
// @Summary Set favorite
// @Tags    assets
// @Accept  json
// @Produce json
// @Param   id   path string                  true "asset id"
// @Param   body body apitypes.FavoriteRequest true "favorite flag"
// @Success 200 {object} map[string]bool
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/assets/{id}/favorite [post]
func (d Deps) setFavorite(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	fav := 0
	if req.Favorite {
		fav = 1
	}
	res, err := d.DB.ExecContext(r.Context(),
		`UPDATE assets SET favorite = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		fav, chi.URLParam(r, "id"), owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "favorite_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	d.logAssetChange(r.Context(), chi.URLParam(r, "id"), owner, "update")
	writeJSON(w, http.StatusOK, map[string]bool{"favorite": req.Favorite})
}

// listFavorites returns the favorites feed (F-08 favorites user story).
// @Summary List favorites
// @Tags    assets
// @Produce json
// @Param   limit query int false "page size"
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Router  /api/favorites [get]
func (d Deps) listFavorites(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	limit := parseLimit(r.URL.Query().Get("limit"))
	cursor, cursorArgs, ok := requestCursor(w, r)
	if !ok {
		return
	}
	args := append([]any{owner}, cursorArgs...)
	args = append(args, limit+1)
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL("WHERE a.favorite = 1 AND a.owner_id = ? AND a.deleted_at IS NULL"+cursor)+" LIMIT ?", args...)
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
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}
