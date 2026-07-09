package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/trash"
)

// deleteAsset soft-deletes an asset into the trash (F-10).
func (d Deps) deleteAsset(w http.ResponseWriter, r *http.Request) {
	err := trash.Delete(r.Context(), d.DB, d.Store, chi.URLParam(r, "id"))
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
func (d Deps) restoreAsset(w http.ResponseWriter, r *http.Request) {
	err := trash.Restore(r.Context(), d.DB, d.Store, chi.URLParam(r, "id"))
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

// listTrash lists soft-deleted assets awaiting restore or purge (F-10).
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
	writeJSON(w, http.StatusOK, assetListResponse{Assets: assets, NextCursor: next})
}
