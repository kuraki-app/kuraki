package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/importer"
)

// mediaIssues exposes durable derivative failures. The original is still safe;
// this endpoint makes the missing preview or playback path visible to users.
// @Summary List media issues
// @Tags    media
// @Produce json
// @Success 200 {object} apitypes.MediaIssueList
// @Failure 401 {object} apitypes.Error
// @Router  /api/media/issues [get]
func (d Deps) mediaIssues(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT m.asset_id, a.filename, a.media_type, m.kind, m.message, m.created_at
		FROM media_issues m
		JOIN assets a ON a.id = m.asset_id
		WHERE a.owner_id = ? AND a.deleted_at IS NULL
		ORDER BY m.created_at DESC
		LIMIT 100`, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_media_issues_failed")
		return
	}
	defer rows.Close()
	issues := make([]apitypes.MediaIssue, 0)
	for rows.Next() {
		var issue apitypes.MediaIssue
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
	writeJSON(w, http.StatusOK, apitypes.MediaIssueList{Issues: issues})
}

// rebuildAsset regenerates an asset's derivatives from the stored original,
// clearing any media issues it resolves. It runs in the background because a
// video playback derivative can take a while; the client can watch the media
// health list update.
// @Summary Rebuild asset derivatives
// @Tags    media
// @Produce json
// @Param   id path string true "asset id"
// @Success 202 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 503 {object} apitypes.Error
// @Router  /api/assets/{id}/rebuild [post]
func (d Deps) rebuildAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var one int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT 1 FROM assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, id, owner).Scan(&one)
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
