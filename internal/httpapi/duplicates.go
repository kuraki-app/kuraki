package httpapi

import (
	"database/sql"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/media"
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

// dupCandidateLimit bounds the O(n^2) clustering so a very large library cannot
// stall the request; the newest images are considered first.
const dupCandidateLimit = 20000

// duplicates groups images whose perceptual hashes are within dupThreshold —
// visually identical or near-identical copies that byte-level dedup does not
// catch. The default is "keep both": nothing is removed automatically.
func (d Deps) duplicates(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT a.id, a.phash, a.filename, a.size_bytes, a.taken_at,
		       (SELECT dv.path FROM derivatives dv WHERE dv.asset_id = a.id AND dv.kind = 'thumb')
		FROM assets a
		WHERE a.media_type = 'image' AND a.phash IS NOT NULL AND a.deleted_at IS NULL
		ORDER BY COALESCE(a.taken_at, a.created_at) DESC
		LIMIT ?`, dupCandidateLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_duplicates_failed")
		return
	}
	defer rows.Close()

	var assets []dupAsset
	var hashes []uint64
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
		assets = append(assets, a)
		hashes = append(hashes, uint64(phash))
	}

	groups := clusterByHash(assets, hashes, dupThreshold)
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

// clusterByHash groups items whose hashes are within threshold using union-find.
func clusterByHash(assets []dupAsset, hashes []uint64, threshold int) [][]dupAsset {
	n := len(assets)
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if media.Hamming(hashes[i], hashes[j]) <= threshold {
				parent[find(i)] = find(j)
			}
		}
	}

	byRoot := map[int][]dupAsset{}
	order := []int{}
	for i := range assets {
		root := find(i)
		if _, seen := byRoot[root]; !seen {
			order = append(order, root)
		}
		byRoot[root] = append(byRoot[root], assets[i])
	}
	groups := make([][]dupAsset, 0)
	for _, root := range order {
		if g := byRoot[root]; len(g) > 1 {
			groups = append(groups, g)
		}
	}
	return groups
}
