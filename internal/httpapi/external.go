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
