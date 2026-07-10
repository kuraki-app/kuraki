package httpapi

import (
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"

	"github.com/kuraki-app/kuraki/internal/importer"
)

// maxUploadBytes caps a single multipart upload request.
const maxUploadBytes = 1 << 30 // 1 GiB

// uploadAsset accepts browser drag-and-drop uploads and runs them through the
// same importer pipeline as the CLI (dedup, EXIF date, thumbnails) — F-13/F-05.
func (d Deps) uploadAsset(w http.ResponseWriter, r *http.Request) {
	if d.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "media_unavailable")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload")
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no_file")
		return
	}

	// Stage uploads in a temp dir, then import that dir in one pass.
	tmpDir, err := os.MkdirTemp("", "kuraki-upload-")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stage_failed")
		return
	}
	defer os.RemoveAll(tmpDir)

	for _, fh := range files {
		if err := stageUpload(tmpDir, fh); err != nil {
			writeError(w, http.StatusInternalServerError, "stage_failed")
			return
		}
	}

	owner := ""
	if u := d.currentUser(r); u != nil {
		owner = u.Username
	}
	runner := importer.Importer{DB: d.DB, Store: d.Store, Media: d.Media, ThumbMaxEdge: d.ThumbSize}
	result, err := runner.Run(r.Context(), importer.Options{SourceDir: tmpDir, OwnerUsername: owner})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "import_failed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"imported":   result.Imported,
		"duplicates": result.Duplicates,
		"skipped":    result.Skipped,
		"errors":     len(result.Errors),
	})
}

func stageUpload(dir string, fh *multipart.FileHeader) error {
	src, err := fh.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(filepath.Join(dir, filepath.Base(fh.Filename)))
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}
