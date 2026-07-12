package httpapi

import (
	"database/sql"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/duplicates"
)

type dupAsset struct {
	ID           string  `json:"id"`
	Filename     string  `json:"filename"`
	SizeBytes    int64   `json:"size_bytes"`
	TakenAt      *string `json:"taken_at,omitempty"`
	ThumbnailURL *string `json:"thumbnail_url,omitempty"`
}

// dupThreshold is the maximum perceptual-hash hamming distance for two images to
// be treated as duplicates. 0 is an exact structural match; a small value also
// catches near-duplicates (light edits, crops, re-compression).
const dupThreshold = 8

// duplicates groups images whose perceptual hashes are within dupThreshold —
// visually identical or near-identical copies that byte-level dedup does not
// catch. The default is "keep both": nothing is removed automatically.
func (d Deps) duplicates(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var ownerID string
	if err := d.DB.QueryRowContext(r.Context(), `SELECT id FROM users WHERE username=?`, u.Username).Scan(&ownerID); err != nil {
		writeError(w, 500, "duplicate_owner_failed")
		return
	}
	run, ok, err := duplicates.Latest(r.Context(), d.DB, ownerID)
	if err != nil {
		writeError(w, 500, "duplicate_run_failed")
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"groups": []dupAsset{}, "run": nil})
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT gm.group_id,a.id,a.filename,a.size_bytes,a.taken_at,
		       (SELECT dv.path FROM derivatives dv WHERE dv.asset_id=a.id AND dv.kind IN ('thumb','poster') ORDER BY CASE dv.kind WHEN 'thumb' THEN 0 ELSE 1 END LIMIT 1)
		FROM duplicate_group_members gm JOIN assets a ON a.id=gm.asset_id
		WHERE gm.run_id=? ORDER BY gm.group_id,a.id`, run.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_duplicates_failed")
		return
	}
	defer rows.Close()

	groups := make([][]dupAsset, 0)
	groupID := -1
	var group []dupAsset
	for rows.Next() {
		var id, filename string
		var currentGroup int
		var size int64
		var takenAt, thumb sql.NullString
		if err := rows.Scan(&currentGroup, &id, &filename, &size, &takenAt, &thumb); err != nil {
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
		if groupID != -1 && currentGroup != groupID {
			groups = append(groups, group)
			group = nil
		}
		groupID = currentGroup
		group = append(group, a)
	}
	if len(group) > 0 {
		groups = append(groups, group)
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups, "run": run})
}

// runDuplicates starts a durable complete-library scan. A successful run is
// retained in duplicate_runs/group_members for operational inspection.
func (d Deps) runDuplicates(w http.ResponseWriter, r *http.Request) {
	u := d.currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var ownerID string
	if err := d.DB.QueryRowContext(r.Context(), `SELECT id FROM users WHERE username=?`, u.Username).Scan(&ownerID); err != nil {
		writeError(w, http.StatusInternalServerError, "duplicate_owner_failed")
		return
	}
	run, err := duplicates.Enqueue(r.Context(), d.DB, ownerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "duplicate_enqueue_failed")
		return
	}
	writeJSON(w, http.StatusAccepted, run)
}
