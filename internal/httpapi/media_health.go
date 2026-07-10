package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/importer"
)

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

// rebuildAsset regenerates an asset's derivatives from the stored original,
// clearing any media issues it resolves. It runs in the background because a
// video playback derivative can take a while; the client can watch the media
// health list update.
func (d Deps) rebuildAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var one int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup_failed")
		return
	}
	if d.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "media_unavailable")
		return
	}

	runner := importer.Importer{DB: d.DB, Store: d.Store, Media: d.Media, ThumbMaxEdge: d.ThumbSize}
	go func() {
		if err := runner.RebuildDerivatives(context.Background(), id); err != nil {
			d.Logger.Warn("rebuild derivatives failed", "asset", id, "err", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "rebuilding"})
}
