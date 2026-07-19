package httpapi

import (
	"net/http"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// stats reports library totals for the dashboard.
func (d Deps) stats(w http.ResponseWriter, r *http.Request) {
	var s apitypes.LibraryStats
	ctx := r.Context()

	err := d.DB.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(size_bytes), 0),
		       COALESCE(SUM(media_type = 'image'), 0),
		       COALESCE(SUM(media_type = 'video'), 0),
		       COALESCE(SUM(favorite), 0)
		FROM assets WHERE deleted_at IS NULL`).
		Scan(&s.Total, &s.TotalBytes, &s.Images, &s.Videos, &s.Favorites)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stats_failed")
		return
	}

	_ = d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assets WHERE deleted_at IS NOT NULL`).Scan(&s.Trashed)
	_ = d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM albums WHERE deleted_at IS NULL`).Scan(&s.Albums)
	_ = d.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM assets
			WHERE deleted_at IS NULL AND place_city IS NOT NULL AND place_city <> ''
			GROUP BY place_country, place_city
		)`).Scan(&s.Places)

	rows, err := d.DB.QueryContext(ctx, `
		SELECT substr(COALESCE(taken_at, created_at), 1, 4) AS yr, COUNT(*)
		FROM assets WHERE deleted_at IS NULL
		GROUP BY yr ORDER BY yr DESC`)
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
