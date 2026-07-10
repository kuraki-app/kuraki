package httpapi

import "net/http"

type mediaIssueDTO struct {
	AssetID   string `json:"asset_id"`
	Filename  string `json:"filename"`
	MediaType string `json:"media_type"`
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}

// mediaIssues exposes durable derivative failures. The original is still safe;
// this endpoint makes the missing preview or playback path visible to users.
func (d Deps) mediaIssues(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT m.asset_id, a.filename, a.media_type, m.kind, m.message, m.created_at
		FROM media_issues m
		JOIN assets a ON a.id = m.asset_id
		WHERE a.deleted_at IS NULL
		ORDER BY m.created_at DESC
		LIMIT 100`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_media_issues_failed")
		return
	}
	defer rows.Close()
	issues := make([]mediaIssueDTO, 0)
	for rows.Next() {
		var issue mediaIssueDTO
		if err := rows.Scan(&issue.AssetID, &issue.Filename, &issue.MediaType, &issue.Kind, &issue.Message, &issue.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_media_issues_failed")
			return
		}
		issues = append(issues, issue)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "scan_media_issues_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"issues": issues})
}
