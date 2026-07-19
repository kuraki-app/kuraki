package httpapi

import "net/http"

// maxUploadBytes caps a single multipart upload request.
const maxUploadBytes = 1 << 30 // 1 GiB

// uploadAsset accepts browser uploads, stages them, and enqueues a background
// import job so the request returns immediately. The client polls the job for
// progress (F-13/F-05/F-04).
// @Summary Upload asset
// @Tags    assets
// @Accept  mpfd
// @Produce json
// @Param   file formData file true "media file"
// @Success 202 {object} map[string]interface{}
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 503 {object} apitypes.Error
// @Router  /api/assets [post]
func (d Deps) uploadAsset(w http.ResponseWriter, r *http.Request) {
	if d.Queue == nil {
		writeError(w, http.StatusServiceUnavailable, "queue_unavailable")
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

	owner := ""
	if u := d.currentUser(r); u != nil {
		owner = u.Username
	}
	jobID, err := d.Queue.EnqueueUpload(r.Context(), owner, files)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "enqueue_failed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID, "status": "queued", "count": len(files)})
}
