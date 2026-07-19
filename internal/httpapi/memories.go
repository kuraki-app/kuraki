package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// onThisDay returns assets captured on today's month/day in previous years
// ("On this day" memories, F-26). An optional ?date=YYYY-MM-DD overrides today.
func (d Deps) onThisDay(w http.ResponseWriter, r *http.Request) {
	md := time.Now().Format("01-02")
	if raw := strings.TrimSpace(r.URL.Query().Get("date")); raw != "" {
		if t, err := time.Parse("2006-01-02", raw); err == nil {
			md = t.Format("01-02")
		}
	}
	limit := parseLimit(r.URL.Query().Get("limit"))

	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL(
			"WHERE a.deleted_at IS NULL AND a.taken_at IS NOT NULL "+
				"AND strftime('%m-%d', a.taken_at) = ?")+" LIMIT ?",
		md, limit+1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_memories_failed")
		return
	}
	defer rows.Close()
	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_memories_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}
