package httpapi

import (
	"context"
	"database/sql"
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
// @Summary Delta feed
// @Tags    sync
// @Produce json
// @Param   since query int false "cursor"
// @Param   limit query int false "page size"
// @Success 200 {object} apitypes.ChangesResponse
// @Failure 401 {object} apitypes.Error
// @Router  /api/changes [get]
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

	// Every writer sets owner_id, and migration 00023 attributed the last
	// legacy NULL rows (pre-00020 entries for already-purged assets) to the
	// sole owner. The feed's old `OR owner_id IS NULL` fallback is therefore
	// dead, and would have shown one owner's entries to everyone.
	//
	// If the client's cursor is below the pruned floor (the oldest retained id),
	// the rows it hasn't seen were pruned — it can never catch up incrementally,
	// so tell it to resync: discard its mirror and reload, then resume from the
	// current head. `since == 0` is a fresh/initial client (already a full load),
	// so it never triggers a reset.
	var oldestKept sql.NullInt64
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT MIN(id) FROM change_log WHERE owner_id = ?`, owner).Scan(&oldestKept); err != nil {
		writeError(w, http.StatusInternalServerError, "changes_floor_failed")
		return
	}
	if since > 0 && oldestKept.Valid && since < oldestKept.Int64-1 {
		var maxID sql.NullInt64
		if err := d.DB.QueryRowContext(r.Context(),
			`SELECT MAX(id) FROM change_log WHERE owner_id = ?`, owner).Scan(&maxID); err != nil {
			writeError(w, http.StatusInternalServerError, "changes_head_failed")
			return
		}
		writeJSON(w, http.StatusOK, apitypes.ChangesResponse{
			Reset:   true,
			Cursor:  maxID.Int64,
			Changes: make([]apitypes.ChangeEntry, 0),
			HasMore: false,
		})
		return
	}

	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT id, entity, entity_id, op FROM change_log
		 WHERE id > ? AND owner_id = ?
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
