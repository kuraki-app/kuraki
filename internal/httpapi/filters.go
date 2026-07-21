package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// assetFilters holds the SQL fragments for one query built from the shared
// filter language. joinArgs bind placeholders that appear in JOIN clauses (which
// the generated SQL emits before the WHERE clause), so they must be applied
// ahead of whereArgs.
type assetFilters struct {
	joins     []string
	joinArgs  []any
	where     []string
	whereArgs []any
}

// parseAssetFilters reads the single filter language used identically by the web
// UI, the web search page, and the mobile client: q (full-text), from, to
// (date range), type (media type), camera, favorite, rating, place_city,
// place_country, album, archived, hidden. It returns a non-empty error code on
// invalid input.
func parseAssetFilters(r *http.Request) (assetFilters, string) {
	qv := r.URL.Query()
	f := assetFilters{where: []string{"a.deleted_at IS NULL"}}

	if q := strings.TrimSpace(qv.Get("q")); q != "" {
		f.joins = append(f.joins, "JOIN assets_fts ff ON ff.asset_id = a.id")
		f.joinArgs = append(f.joinArgs, ftsQuery(q))
		f.where = append(f.where, "ff.assets_fts MATCH ?")
	}
	if from := strings.TrimSpace(qv.Get("from")); from != "" {
		f.where = append(f.where, "COALESCE(a.taken_at, a.created_at) >= ?")
		f.whereArgs = append(f.whereArgs, from)
	}
	if to := strings.TrimSpace(qv.Get("to")); to != "" {
		f.where = append(f.where, "COALESCE(a.taken_at, a.created_at) <= ?")
		f.whereArgs = append(f.whereArgs, to)
	}
	if mediaType := strings.TrimSpace(qv.Get("type")); mediaType != "" {
		f.where = append(f.where, "a.media_type = ?")
		f.whereArgs = append(f.whereArgs, mediaType)
	}
	if camera := strings.TrimSpace(qv.Get("camera")); camera != "" {
		f.where = append(f.where, "a.camera_model = ?")
		f.whereArgs = append(f.whereArgs, camera)
	}
	if qv.Get("favorite") == "1" {
		f.where = append(f.where, "a.favorite = 1")
	}
	if rating := strings.TrimSpace(qv.Get("rating")); rating != "" {
		value, err := strconv.Atoi(rating)
		if err != nil || value < 0 || value > 5 {
			return assetFilters{}, "invalid_rating"
		}
		f.where = append(f.where, "a.rating = ?")
		f.whereArgs = append(f.whereArgs, value)
	}
	if city := strings.TrimSpace(qv.Get("place_city")); city != "" {
		f.where = append(f.where, "a.place_city = ?")
		f.whereArgs = append(f.whereArgs, city)
	}
	if country := strings.TrimSpace(qv.Get("place_country")); country != "" {
		f.where = append(f.where, "a.place_country = ?")
		f.whereArgs = append(f.whereArgs, country)
	}
	if album := strings.TrimSpace(qv.Get("album")); album != "" {
		f.joins = append(f.joins, "JOIN album_assets aa ON aa.asset_id = a.id AND aa.album_id = ?")
		f.joinArgs = append(f.joinArgs, album)
	}
	// Archive and Hidden are excluded by default and shown only when asked for
	// explicitly, matching the timeline's sections.
	if qv.Get("archived") == "1" {
		f.where = append(f.where, "a.archived = 1")
	} else {
		f.where = append(f.where, "a.archived = 0")
	}
	if qv.Get("hidden") == "1" {
		f.where = append(f.where, "a.hidden = 1")
	} else {
		f.where = append(f.where, "a.hidden = 0")
	}
	return f, ""
}

// respondFiltered runs the shared filter query with cursor pagination and writes
// the asset page. Both the authenticated web search and the device-authenticated
// mobile library use it, so the two surfaces stay byte-for-byte identical.
// @Summary List captured library (device)
// @Tags    capture
// @Produce json
// @Param   cursor query string false "pagination cursor"
// @Param   limit  query int    false "page size"
// @Param   q      query string false "full-text query"
// @Success 200 {object} apitypes.AssetList
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/capture/library [get]
func (d Deps) respondFiltered(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"))
	filters, ferr := parseAssetFilters(r)
	if ferr != "" {
		writeError(w, http.StatusBadRequest, ferr)
		return
	}
	cursorTime, cursorID, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	where := append([]string{}, filters.where...)
	args := append([]any{}, filters.joinArgs...)
	args = append(args, filters.whereArgs...)
	where = append(where, "a.owner_id = ?")
	args = append(args, owner)
	if cursorTime != "" {
		where = append(where, "(COALESCE(a.taken_at, a.created_at) < ? OR (COALESCE(a.taken_at, a.created_at) = ? AND a.id < ?))")
		args = append(args, cursorTime, cursorTime, cursorID)
	}
	args = append(args, limit+1)

	join := strings.Join(filters.joins, " ")
	rows, err := d.DB.QueryContext(r.Context(), assetSelectSQLWithJoin(join, "WHERE "+strings.Join(where, " AND "))+` LIMIT ?`, args...)
	if err != nil {
		writeError(w, http.StatusBadRequest, "search_assets_failed")
		return
	}
	defer rows.Close()

	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_assets_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}
