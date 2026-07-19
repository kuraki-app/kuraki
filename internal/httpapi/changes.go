package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// logAssetChange records an asset mutation in change_log for the delta feed.
// Best-effort: a logging failure must never fail the user's mutation, but it is
// recorded via slog so a silently-missing feed entry is diagnosable.
func (d Deps) logAssetChange(ctx context.Context, assetID, owner, op string) {
	if _, err := d.DB.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, ?, ?)`,
		assetID, op, owner); err != nil {
		d.Logger.Warn("change_log write failed", "asset", assetID, "op", op, "err", err)
	}
}

const (
	changesDefaultLimit = 500
	changesMaxLimit     = 1000
)

// changes serves the owner-scoped delta feed. The client passes its last cursor
// as ?since=; the response's cursor is fed straight back next time. Thin by
// design — entries carry only the id/op, and the client refetches changed assets
// via the existing asset endpoints.
func (d Deps) changes(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if since < 0 {
		since = 0
	}
	limit := changesDefaultLimit
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > changesMaxLimit {
		limit = changesMaxLimit
	}

	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT id, entity, entity_id, op FROM change_log
		 WHERE id > ? AND (owner_id = ? OR owner_id IS NULL)
		 ORDER BY id ASC LIMIT ?`,
		since, owner, limit+1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "changes_query_failed")
		return
	}
	defer rows.Close()

	out := apitypes.ChangesResponse{Cursor: since, Changes: make([]apitypes.ChangeEntry, 0)}
	for rows.Next() {
		var c apitypes.ChangeEntry
		if err := rows.Scan(&c.ID, &c.Entity, &c.EntityID, &c.Op); err != nil {
			writeError(w, http.StatusInternalServerError, "changes_scan_failed")
			return
		}
		out.Changes = append(out.Changes, c)
	}
	// limit+1 fetches one extra to detect has_more without a second query.
	if len(out.Changes) > limit {
		out.HasMore = true
		out.Changes = out.Changes[:limit]
	}
	if n := len(out.Changes); n > 0 {
		out.Cursor = out.Changes[n-1].ID
	}
	writeJSON(w, http.StatusOK, out)
}
