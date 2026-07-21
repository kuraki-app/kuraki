package httpapi

import (
	"net/http"

	"github.com/kuraki-app/kuraki/internal/backup"
)

// backupStatus reports the most recent automatic backup (age + outcome) so the
// Library dashboard can show whether the unattended safety net is running and
// current. When no automatic backup has ever run — including when the feature
// is not configured — it returns {"last": null, "enabled": <bool>}.
// @Summary Backup status
// @Tags    admin
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Failure 401 {object} apitypes.Error
// @Router  /api/backup [get]
func (d Deps) backupStatus(w http.ResponseWriter, r *http.Request) {
	last, ok, err := backup.LastRun(r.Context(), d.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "backup_status_failed")
		return
	}
	resp := map[string]any{"enabled": d.BackupEnabled, "last": nil}
	if ok {
		resp["last"] = last
	}
	writeJSON(w, http.StatusOK, resp)
}
