package httpapi

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
)

type zipRequest struct {
	IDs []string `json:"ids"`
}

// downloadZip streams a zip archive of the selected originals so users can pull
// their data out as easily as they put it in (F-23 / zero-lock-in). The archive
// is streamed, so once the first bytes are written the status can no longer
// change — inputs are therefore validated up front.
func (d Deps) downloadZip(w http.ResponseWriter, r *http.Request) {
	var req zipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "no_ids")
		return
	}
	if len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "too_many_ids")
		return
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(req.IDs)), ",")
	args := make([]any, len(req.IDs))
	for i, id := range req.IDs {
		args[i] = id
	}
	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT original_path, filename FROM assets
		 WHERE deleted_at IS NULL AND id IN (`+placeholders+`)`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_failed")
		return
	}
	type item struct{ path, name string }
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.path, &it.name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan_failed")
			return
		}
		items = append(items, it)
	}
	rows.Close()
	if len(items) == 0 {
		writeError(w, http.StatusNotFound, "no_assets")
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="kuraki-export.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()

	seen := map[string]int{}
	for _, it := range items {
		rc, err := d.Store.Open(r.Context(), "originals/"+it.path)
		if err != nil {
			continue // skip originals that are missing rather than aborting the whole archive
		}
		fw, err := zw.Create(uniqueZipName(seen, it.name))
		if err != nil {
			rc.Close()
			return
		}
		_, _ = io.Copy(fw, rc)
		rc.Close()
	}
}

// uniqueZipName disambiguates repeated filenames (e.g. two IMG_1234.jpg).
func uniqueZipName(seen map[string]int, name string) string {
	if _, ok := seen[name]; !ok {
		seen[name] = 1
		return name
	}
	seen[name]++
	ext := filepath.Ext(name)
	return fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), seen[name]-1, ext)
}
