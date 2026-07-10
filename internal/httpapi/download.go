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

type zipItem struct {
	storagePath string // path within the store, e.g. originals/2026/07/x.jpg
	zipName     string // entry name inside the archive
}

// downloadZip streams a zip archive of the selected originals (zero-lock-in).
// The archive is streamed, so inputs are validated up front.
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
	items := []zipItem{}
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan_failed")
			return
		}
		items = append(items, zipItem{storagePath: "originals/" + path, zipName: name})
	}
	rows.Close()
	if len(items) == 0 {
		writeError(w, http.StatusNotFound, "no_assets")
		return
	}
	streamZip(w, r, d, "kuraki-export.zip", items)
}

// exportLibrary streams a zip of every original in the library, preserving the
// date-organized folder structure. Backing up this archive (plus the database)
// is the manual belt-and-braces companion to `kuraki backup`.
func (d Deps) exportLibrary(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT original_path, filename FROM assets WHERE deleted_at IS NULL ORDER BY original_path`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_failed")
		return
	}
	items := []zipItem{}
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan_failed")
			return
		}
		// Preserve the YYYY/MM structure with the readable filename.
		items = append(items, zipItem{
			storagePath: "originals/" + path,
			zipName:     filepath.ToSlash(filepath.Join(filepath.Dir(path), name)),
		})
	}
	rows.Close()
	if len(items) == 0 {
		writeError(w, http.StatusNotFound, "no_assets")
		return
	}
	streamZip(w, r, d, "kuraki-library.zip", items)
}

func streamZip(w http.ResponseWriter, r *http.Request, d Deps, filename string, items []zipItem) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	zw := zip.NewWriter(w)
	defer zw.Close()

	seen := map[string]int{}
	for _, it := range items {
		rc, err := d.Store.Open(r.Context(), it.storagePath)
		if err != nil {
			continue // skip missing originals rather than aborting the archive
		}
		fw, err := zw.Create(uniqueZipName(seen, it.zipName))
		if err != nil {
			rc.Close()
			return
		}
		_, _ = io.Copy(fw, rc)
		rc.Close()
	}
}

// uniqueZipName disambiguates repeated entry names (e.g. two IMG_1234.jpg).
func uniqueZipName(seen map[string]int, name string) string {
	if _, ok := seen[name]; !ok {
		seen[name] = 1
		return name
	}
	seen[name]++
	ext := filepath.Ext(name)
	return fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), seen[name]-1, ext)
}
