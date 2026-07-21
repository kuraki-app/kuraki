package httpapi

import (
	"context"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/verify"
)

// integrity reports the most recent verification run (last-verified time + result).
// @Summary Integrity status
// @Tags    admin
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Failure 401 {object} apitypes.Error
// @Router  /api/integrity [get]
func (d Deps) integrity(w http.ResponseWriter, r *http.Request) {
	last, ok, err := verify.LastRun(r.Context(), d.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "integrity_failed")
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"last": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"last": last})
}

// runIntegrity kicks off a verification run in the background ("verify now").
// @Summary Run integrity check
// @Tags    admin
// @Produce json
// @Success 202 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Router  /api/integrity/run [post]
func (d Deps) runIntegrity(w http.ResponseWriter, r *http.Request) {
	go func() {
		if _, err := verify.RunAndRecord(context.Background(), d.DB, d.Store); err != nil {
			d.Logger.Warn("manual integrity run failed", "err", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "running"})
}
