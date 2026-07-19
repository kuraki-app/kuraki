package httpapi

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// downloadZip streams a zip archive of the selected originals (zero-lock-in).
// The archive is streamed, so inputs are validated up front.
func (d Deps) downloadZip(w http.ResponseWriter, r *http.Request) {
	var req apitypes.ZipRequest
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
	items := []apitypes.ZipItem{}
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan_failed")
			return
		}
		items = append(items, apitypes.ZipItem{StoragePath: "originals/" + path, ZipName: name})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query_failed")
		return
	}
	if len(items) == 0 {
		writeError(w, http.StatusNotFound, "no_assets")
		return
	}
	if len(items) != uniqueIDCount(req.IDs) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if !d.prepareZip(w, r, items) {
		return
	}
	if err := streamZip(w, r, d, "kuraki-export.zip", items); err != nil && d.Logger != nil {
		d.Logger.Error("zip export interrupted", "err", err)
	}
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
	items := []apitypes.ZipItem{}
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan_failed")
			return
		}
		// Preserve the YYYY/MM structure with the readable filename.
		items = append(items, apitypes.ZipItem{
			StoragePath: "originals/" + path,
			ZipName:     filepath.ToSlash(filepath.Join(filepath.Dir(path), name)),
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "query_failed")
		return
	}
	if len(items) == 0 {
		writeError(w, http.StatusNotFound, "no_assets")
		return
	}
	if !d.prepareZip(w, r, items) {
		return
	}
	if err := streamZip(w, r, d, "kuraki-library.zip", items); err != nil && d.Logger != nil {
		d.Logger.Error("library export interrupted", "err", err)
	}
}

// prepareZip verifies every original before response headers commit a download.
// Originals are write-once, so this prevents a known-bad library from quietly
// producing a successful-looking ZIP with files omitted.
func (d Deps) prepareZip(w http.ResponseWriter, r *http.Request, items []apitypes.ZipItem) bool {
	for _, item := range items {
		exists, err := d.Store.Exists(r.Context(), item.StoragePath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "storage_failed")
			return false
		}
		if !exists {
			writeError(w, http.StatusConflict, "original_unavailable")
			return false
		}
	}
	return true
}

func streamZip(w http.ResponseWriter, r *http.Request, d Deps, filename string, items []apitypes.ZipItem) (err error) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	zw := zip.NewWriter(w)
	defer func() {
		if closeErr := zw.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close zip: %w", closeErr)
		}
	}()

	seen := map[string]int{}
	for _, it := range items {
		rc, err := d.Store.Open(r.Context(), it.StoragePath)
		if err != nil {
			return fmt.Errorf("open original %q: %w", it.ZipName, err)
		}
		fw, err := zw.Create(uniqueZipName(seen, it.ZipName))
		if err != nil {
			rc.Close()
			return fmt.Errorf("create zip entry %q: %w", it.ZipName, err)
		}
		_, copyErr := io.Copy(fw, rc)
		closeErr := rc.Close()
		if copyErr != nil {
			return fmt.Errorf("copy original %q: %w", it.ZipName, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close original %q: %w", it.ZipName, closeErr)
		}
	}
	return nil
}

func uniqueIDCount(ids []string) int {
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		seen[id] = struct{}{}
	}
	return len(seen)
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
