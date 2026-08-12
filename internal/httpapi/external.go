package httpapi

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/external"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// @Summary List external libraries
// @Tags    external
// @Produce json
// @Success 200 {object} apitypes.ExternalLibraryList
// @Failure 401 {object} apitypes.Error
// @Router  /api/external-libraries [get]
func (d Deps) listExternalLibraries(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `SELECT l.id,l.name,l.root_path,l.created_at,COUNT(a.id) FROM external_libraries l LEFT JOIN assets a ON a.external_library_id=l.id AND a.deleted_at IS NULL WHERE l.owner_id=? GROUP BY l.id ORDER BY l.name`, u.ID)
	if err != nil {
		writeError(w, 500, "query_external_libraries_failed")
		return
	}
	defer rows.Close()
	out := make([]apitypes.ExternalLibrary, 0)
	for rows.Next() {
		var x apitypes.ExternalLibrary
		if err := rows.Scan(&x.ID, &x.Name, &x.RootPath, &x.CreatedAt, &x.AssetCount); err != nil {
			writeError(w, 500, "scan_external_libraries_failed")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, apitypes.ExternalLibraryList{Libraries: out})
}

// @Summary Link external library
// @Tags    external
// @Accept  json
// @Produce json
// @Param   body body apitypes.ExternalLibraryRequest true "name + root path"
// @Success 201 {object} map[string]interface{}
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/external-libraries [post]
func (d Deps) createExternalLibrary(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req apitypes.ExternalLibraryRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, 400, "invalid_json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	root, err := filepath.Abs(strings.TrimSpace(req.RootPath))
	if req.Name == "" || err != nil {
		writeError(w, 400, "invalid_external_library")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, 500, "external_library_id_failed")
		return
	}
	if _, err = d.DB.ExecContext(r.Context(), `INSERT INTO external_libraries(id,owner_id,name,root_path) VALUES(?,?,?,?)`, id.String(), u.ID, req.Name, root); err != nil {
		writeError(w, 409, "external_library_exists")
		return
	}
	result, err := external.Scan(r.Context(), d.DB, d.Media, id.String(), u.ID, root)
	if err != nil {
		_, _ = d.DB.ExecContext(r.Context(), `DELETE FROM external_libraries WHERE id=?`, id.String())
		writeError(w, 400, "external_library_scan_failed")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "name": req.Name, "root_path": root, "scanned": result.Scanned, "indexed": result.Indexed})
}

// @Summary Rescan external library
// @Tags    external
// @Produce json
// @Param   id path string true "external library id"
// @Success 200 {object} map[string]interface{}
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/external-libraries/{id}/scan [post]
func (d Deps) scanExternalLibrary(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var id, root string
	err := d.DB.QueryRowContext(r.Context(), `SELECT id,root_path FROM external_libraries WHERE id=? AND owner_id=?`, chi.URLParam(r, "id"), u.ID).Scan(&id, &root)
	if err != nil {
		writeError(w, 404, "external_library_not_found")
		return
	}
	result, err := external.Scan(r.Context(), d.DB, d.Media, id, u.ID, root)
	if err != nil {
		writeError(w, 400, "external_library_scan_failed")
		return
	}
	writeJSON(w, 200, result)
}

// deleteExternalLibrary forgets an external library. There was no way to remove
// one, so a mistyped root path was permanent from the UI.
//
// It removes the LIBRARY, never the files: an external library is a reference to
// media Kuraki does not own and did not copy, so deleting anything on disk would
// violate the write-once rule about originals in the most literal way possible.
// The indexed asset rows go with it — they describe files under a root that is no
// longer tracked — and `assets.external_library_id` is ON DELETE SET NULL, so
// they must be removed explicitly rather than left behind as orphans that look
// like ordinary imported assets.
//
// @Summary Remove external library
// @Tags    external
// @Produce json
// @Param   id path string true "external library id"
// @Success 200 {object} map[string]interface{}
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/external-libraries/{id} [delete]
func (d Deps) deleteExternalLibrary(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var id string
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT id FROM external_libraries WHERE id=? AND owner_id=?`,
		chi.URLParam(r, "id"), u.ID).Scan(&id); err != nil {
		writeError(w, 404, "external_library_not_found")
		return
	}

	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "external_library_delete_failed")
		return
	}
	defer tx.Rollback()

	// Log every removed asset before deleting it, so the delta feed can tell
	// clients to drop them. change_log carries owner_id precisely so a row with
	// no joinable asset still resolves an owner.
	rows, err := tx.QueryContext(r.Context(),
		`SELECT id FROM assets WHERE external_library_id=? AND owner_id=?`, id, u.ID)
	if err != nil {
		writeError(w, 500, "external_library_delete_failed")
		return
	}
	var assetIDs []string
	for rows.Next() {
		var assetID string
		if err := rows.Scan(&assetID); err != nil {
			rows.Close()
			writeError(w, 500, "external_library_delete_failed")
			return
		}
		assetIDs = append(assetIDs, assetID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, 500, "external_library_delete_failed")
		return
	}

	for _, assetID := range assetIDs {
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM assets_fts WHERE asset_id = ?`, assetID); err != nil {
			writeError(w, 500, "external_library_delete_failed")
			return
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM assets WHERE id = ? AND owner_id = ?`, assetID, u.ID); err != nil {
			writeError(w, 500, "external_library_delete_failed")
			return
		}
		if _, err := tx.ExecContext(r.Context(),
			`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'delete', ?)`,
			assetID, u.ID); err != nil {
			writeError(w, 500, "external_library_delete_failed")
			return
		}
	}

	if _, err := tx.ExecContext(r.Context(),
		`DELETE FROM external_libraries WHERE id=? AND owner_id=?`, id, u.ID); err != nil {
		writeError(w, 500, "external_library_delete_failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 500, "external_library_delete_failed")
		return
	}
	writeJSON(w, 200, map[string]any{"removed": len(assetIDs)})
}
