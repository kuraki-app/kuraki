package httpapi

import (
	"database/sql"
	"net/http"
)

type dupAsset struct {
	ID           string  `json:"id"`
	Filename     string  `json:"filename"`
	SizeBytes    int64   `json:"size_bytes"`
	TakenAt      *string `json:"taken_at,omitempty"`
	ThumbnailURL *string `json:"thumbnail_url,omitempty"`
}

// duplicates groups images that share a perceptual hash — visually identical
// copies that byte-level dedup does not catch (e.g. a re-saved or re-encoded
// photo). The default is "keep both": nothing is removed automatically; the user
// reviews each group and chooses what to delete.
func (d Deps) duplicates(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT a.id, a.phash, a.filename, a.size_bytes, a.taken_at,
		       (SELECT dv.path FROM derivatives dv WHERE dv.asset_id = a.id AND dv.kind = 'thumb')
		FROM assets a
		WHERE a.media_type = 'image' AND a.phash IS NOT NULL AND a.deleted_at IS NULL
		  AND a.phash IN (
		      SELECT phash FROM assets
		      WHERE media_type = 'image' AND phash IS NOT NULL AND deleted_at IS NULL
		      GROUP BY phash HAVING COUNT(*) > 1)
		ORDER BY a.phash, a.size_bytes DESC, a.id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_duplicates_failed")
		return
	}
	defer rows.Close()

	groups := make([][]dupAsset, 0)
	var current []dupAsset
	var prev int64
	started := false
	for rows.Next() {
		var id, filename string
		var phash, size int64
		var takenAt, thumb sql.NullString
		if err := rows.Scan(&id, &phash, &filename, &size, &takenAt, &thumb); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_duplicates_failed")
			return
		}
		a := dupAsset{ID: id, Filename: filename, SizeBytes: size}
		if takenAt.Valid {
			a.TakenAt = &takenAt.String
		}
		if thumb.Valid {
			u := "/api/assets/" + id + "/thumb"
			a.ThumbnailURL = &u
		}
		if started && phash != prev {
			if len(current) > 1 {
				groups = append(groups, current)
			}
			current = nil
		}
		current = append(current, a)
		prev, started = phash, true
	}
	if len(current) > 1 {
		groups = append(groups, current)
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}
