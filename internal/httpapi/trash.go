package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/trash"
)

// deleteAsset soft-deletes an asset into the trash (F-10).
// @Summary Delete asset
// @Tags    assets
// @Produce json
// @Param   id path string true "asset id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/assets/{id} [delete]
// @Router  /api/capture/assets/{id} [delete]
func (d Deps) deleteAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if ok, err := d.ownsAsset(r, id); err != nil {
		writeError(w, http.StatusInternalServerError, "asset_lookup_failed")
		return
	} else if !ok {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	err := trash.Delete(r.Context(), d.DB, d.Store, id)
	switch {
	case errors.Is(err, trash.ErrNotFound):
		writeError(w, http.StatusNotFound, "asset_not_found")
	case errors.Is(err, trash.ErrAlreadyDeleted):
		writeError(w, http.StatusConflict, "already_deleted")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "delete_failed")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "trashed"})
	}
}

// restoreAsset restores an asset from the trash (F-10).
// @Summary Restore asset from trash
// @Tags    assets
// @Produce json
// @Param   id path string true "asset id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/assets/{id}/restore [post]
// @Router  /api/capture/assets/{id}/restore [post]
func (d Deps) restoreAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if ok, err := d.ownsAsset(r, id); err != nil {
		writeError(w, http.StatusInternalServerError, "asset_lookup_failed")
		return
	} else if !ok {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	err := trash.Restore(r.Context(), d.DB, d.Store, id)
	switch {
	case errors.Is(err, trash.ErrNotFound):
		writeError(w, http.StatusNotFound, "asset_not_found")
	case errors.Is(err, trash.ErrNotDeleted):
		writeError(w, http.StatusConflict, "not_in_trash")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "restore_failed")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
	}
}

// purgeAsset permanently deletes a trashed asset (device-authenticated).
// @Summary Purge asset from trash
// @Tags    capture
// @Produce json
// @Param   id path string true "asset id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/capture/trash/{id} [delete]
func (d Deps) purgeAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if ok, err := d.ownsAsset(r, id); err != nil {
		writeError(w, http.StatusInternalServerError, "asset_lookup_failed")
		return
	} else if !ok {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	err := trash.Purge(r.Context(), d.DB, d.Store, id)
	switch {
	case errors.Is(err, trash.ErrNotFound):
		writeError(w, http.StatusNotFound, "asset_not_found")
	case errors.Is(err, trash.ErrNotDeleted):
		writeError(w, http.StatusConflict, "not_in_trash")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "purge_failed")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "purged"})
	}
}

// listTrash lists soft-deleted assets awaiting restore or purge (F-10).
// @Summary List trash
// @Tags    trash
// @Produce json
// @Param   cursor query string false "pagination cursor"
// @Param   limit  query int    false "page size"
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Router  /api/trash [get]
// @Router  /api/capture/trash [get]
func (d Deps) listTrash(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"))
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL("WHERE a.deleted_at IS NOT NULL")+" LIMIT ?", limit+1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_trash_failed")
		return
	}
	defer rows.Close()
	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_trash_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}
