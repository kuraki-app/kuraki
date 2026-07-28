package httpapi

import (
	"net/http"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// stats reports library totals for the dashboard. Every aggregate is scoped to
// the calling owner -- these counts describe the caller's library, not the
// server's.
// @Summary Library stats
// @Tags    stats
// @Produce json
// @Success 200 {object} apitypes.LibraryStats
// @Failure 401 {object} apitypes.Error
// @Router  /api/stats [get]
func (d Deps) stats(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var s apitypes.LibraryStats
	ctx := r.Context()

	err := d.DB.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(size_bytes), 0),
		       COALESCE(SUM(media_type = 'image'), 0),
		       COALESCE(SUM(media_type = 'video'), 0),
		       COALESCE(SUM(favorite), 0)
		FROM assets WHERE owner_id = ? AND deleted_at IS NULL`, owner).
		Scan(&s.Total, &s.TotalBytes, &s.Images, &s.Videos, &s.Favorites)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stats_failed")
		return
	}

	_ = d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assets WHERE owner_id = ? AND deleted_at IS NOT NULL`, owner).Scan(&s.Trashed)
	_ = d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM albums WHERE owner_id = ? AND deleted_at IS NULL`, owner).Scan(&s.Albums)
	_ = d.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM assets
			WHERE owner_id = ? AND deleted_at IS NULL AND place_city IS NOT NULL AND place_city <> ''
			GROUP BY place_country, place_city
		)`, owner).Scan(&s.Places)

	rows, err := d.DB.QueryContext(ctx, `
		SELECT substr(COALESCE(taken_at, created_at), 1, 4) AS yr, COUNT(*)
		FROM assets WHERE owner_id = ? AND deleted_at IS NULL
		GROUP BY yr ORDER BY yr DESC`, owner)
	if err == nil {
		defer rows.Close()
		s.ByYear = make([]apitypes.YearCount, 0)
		for rows.Next() {
			var y apitypes.YearCount
			if err := rows.Scan(&y.Year, &y.Count); err == nil {
				s.ByYear = append(s.ByYear, y)
			}
		}
	}

	writeJSON(w, http.StatusOK, s)
}
