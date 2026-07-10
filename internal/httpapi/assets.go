package httpapi

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	defaultAssetLimit = 100
	maxAssetLimit     = 200
)

type assetDTO struct {
	ID           string   `json:"id"`
	Filename     string   `json:"filename"`
	MimeType     string   `json:"mime_type"`
	MediaType    string   `json:"media_type"`
	Width        int      `json:"width"`
	Height       int      `json:"height"`
	SizeBytes    int64    `json:"size_bytes"`
	TakenAt      *string  `json:"taken_at,omitempty"`
	TakenDay     *string  `json:"taken_day,omitempty"`
	TakenMonth   *string  `json:"taken_month,omitempty"`
	CameraMake   string   `json:"camera_make"`
	CameraModel  string   `json:"camera_model"`
	GPSLat       *float64 `json:"gps_lat,omitempty"`
	GPSLon       *float64 `json:"gps_lon,omitempty"`
	DurationMS   int64    `json:"duration_ms"`
	Favorite     bool     `json:"favorite"`
	Description  *string  `json:"description,omitempty"`
	PlaceCity    *string  `json:"place_city,omitempty"`
	PlaceCountry *string  `json:"place_country,omitempty"`
	OriginalURL  string   `json:"original_url"`
	ThumbnailURL *string  `json:"thumbnail_url,omitempty"`
	CreatedAt    string   `json:"created_at"`
}

type assetListResponse struct {
	Assets     []assetDTO `json:"assets"`
	NextCursor string     `json:"next_cursor,omitempty"`
}

type assetRow struct {
	ID           string
	OriginalPath string
	Filename     string
	MimeType     string
	MediaType    string
	Width        int
	Height       int
	SizeBytes    int64
	TakenAt      sql.NullString
	CameraMake   string
	CameraModel  string
	GPSLat       sql.NullFloat64
	GPSLon       sql.NullFloat64
	DurationMS   int64
	Favorite     int
	CreatedAt    string
	Description  sql.NullString
	PlaceCity    sql.NullString
	PlaceCountry sql.NullString
	ThumbPath    sql.NullString
}

func (d Deps) listAssets(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"))
	cursorTime, cursorID, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}

	args := []any{}
	where := "deleted_at IS NULL"
	if cursorTime != "" {
		where += " AND (COALESCE(taken_at, created_at) < ? OR (COALESCE(taken_at, created_at) = ? AND id < ?))"
		args = append(args, cursorTime, cursorTime, cursorID)
	}
	args = append(args, limit+1)

	rows, err := d.DB.QueryContext(r.Context(), assetSelectSQL("WHERE "+where)+` LIMIT ?`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_assets_failed")
		return
	}
	defer rows.Close()

	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_assets_failed")
		return
	}
	writeJSON(w, http.StatusOK, assetListResponse{Assets: assets, NextCursor: next})
}

func (d Deps) getAsset(w http.ResponseWriter, r *http.Request) {
	row, err := d.lookupAsset(r, chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_asset_failed")
		return
	}
	writeJSON(w, http.StatusOK, row.toDTO())
}

func (d Deps) searchAssets(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := parseLimit(r.URL.Query().Get("limit"))

	where := []string{"a.deleted_at IS NULL"}
	args := []any{}
	if q != "" {
		where = append(where, "f.assets_fts MATCH ?")
		args = append(args, ftsQuery(q))
	}
	if from := strings.TrimSpace(r.URL.Query().Get("from")); from != "" {
		where = append(where, "COALESCE(a.taken_at, a.created_at) >= ?")
		args = append(args, from)
	}
	if to := strings.TrimSpace(r.URL.Query().Get("to")); to != "" {
		where = append(where, "COALESCE(a.taken_at, a.created_at) <= ?")
		args = append(args, to)
	}
	if mediaType := strings.TrimSpace(r.URL.Query().Get("type")); mediaType != "" {
		where = append(where, "a.media_type = ?")
		args = append(args, mediaType)
	}
	if camera := strings.TrimSpace(r.URL.Query().Get("camera")); camera != "" {
		where = append(where, "a.camera_model = ?")
		args = append(args, camera)
	}
	args = append(args, limit)

	join := "LEFT JOIN assets_fts f ON f.asset_id = a.id"
	if q != "" {
		join = "JOIN assets_fts f ON f.asset_id = a.id"
	}
	rows, err := d.DB.QueryContext(r.Context(), assetSelectSQLWithJoin(join, "WHERE "+strings.Join(where, " AND "))+` LIMIT ?`, args...)
	if err != nil {
		writeError(w, http.StatusBadRequest, "search_assets_failed")
		return
	}
	defer rows.Close()

	assets, _, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_assets_failed")
		return
	}
	writeJSON(w, http.StatusOK, assetListResponse{Assets: assets})
}

func (d Deps) serveOriginal(w http.ResponseWriter, r *http.Request) {
	row, err := d.lookupAsset(r, chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_asset_failed")
		return
	}
	// Originals are content-addressed and never change: cache aggressively.
	serveStored(w, r, d, "originals/"+row.OriginalPath, row.MimeType, row.Filename,
		"private, max-age=31536000, immutable")
}

func (d Deps) serveThumb(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var rel, format string
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT path, format FROM derivatives
		 WHERE asset_id = ? AND kind IN ('thumb', 'poster')
		 ORDER BY CASE kind WHEN 'thumb' THEN 0 ELSE 1 END
		 LIMIT 1`,
		id).Scan(&rel, &format)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "thumb_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_thumb_failed")
		return
	}
	contentType := "image/jpeg"
	if format == "webp" {
		contentType = "image/webp"
	}
	// Thumbnails are stable per asset; cache for a week so the timeline scrolls
	// without re-fetching.
	serveStored(w, r, d, "derivatives/"+rel, contentType, filepath.Base(rel),
		"private, max-age=604800")
}

func (d Deps) lookupAsset(r *http.Request, id string) (assetRow, error) {
	var row assetRow
	err := d.DB.QueryRowContext(r.Context(), assetSelectSQL("WHERE a.id = ? AND a.deleted_at IS NULL")+" LIMIT 1", id).
		Scan(assetScanDest(&row)...)
	return row, err
}

func assetSelectSQL(where string) string {
	return assetSelectSQLWithJoin("", where)
}

func assetSelectSQLWithJoin(join, where string) string {
	return `
		SELECT
			a.id, a.original_path, a.filename, a.mime_type, a.media_type,
			a.width, a.height, a.size_bytes, a.taken_at, a.camera_make,
			a.camera_model, a.gps_lat, a.gps_lon, a.duration_ms, a.favorite,
			a.created_at, a.description, a.place_city, a.place_country, COALESCE(d_thumb.path, d_poster.path)
		FROM assets a
		LEFT JOIN derivatives d_thumb ON d_thumb.asset_id = a.id AND d_thumb.kind = 'thumb'
		LEFT JOIN derivatives d_poster ON d_poster.asset_id = a.id AND d_poster.kind = 'poster'
		` + join + `
		` + where + `
		ORDER BY COALESCE(a.taken_at, a.created_at) DESC, a.id DESC`
}

func assetScanDest(row *assetRow) []any {
	return []any{
		&row.ID, &row.OriginalPath, &row.Filename, &row.MimeType, &row.MediaType,
		&row.Width, &row.Height, &row.SizeBytes, &row.TakenAt, &row.CameraMake,
		&row.CameraModel, &row.GPSLat, &row.GPSLon, &row.DurationMS, &row.Favorite,
		&row.CreatedAt, &row.Description, &row.PlaceCity, &row.PlaceCountry, &row.ThumbPath,
	}
}

func scanAssetRows(rows *sql.Rows, limit int) ([]assetDTO, string, error) {
	out := make([]assetDTO, 0)
	for rows.Next() {
		var row assetRow
		if err := rows.Scan(assetScanDest(&row)...); err != nil {
			return nil, "", err
		}
		out = append(out, row.toDTO())
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if len(out) <= limit {
		return out, "", nil
	}
	nextRow := out[limit-1]
	out = out[:limit]
	cursorTime := nextRow.CreatedAt
	if nextRow.TakenAt != nil {
		cursorTime = *nextRow.TakenAt
	}
	return out, encodeCursor(cursorTime, nextRow.ID), nil
}

func (row assetRow) toDTO() assetDTO {
	var takenAt, takenDay, takenMonth *string
	if row.TakenAt.Valid {
		takenAt = &row.TakenAt.String
		if len(row.TakenAt.String) >= len("2006-01-02") {
			day := row.TakenAt.String[:len("2006-01-02")]
			takenDay = &day
		}
		if len(row.TakenAt.String) >= len("2006-01") {
			month := row.TakenAt.String[:len("2006-01")]
			takenMonth = &month
		}
	}
	var lat, lon *float64
	if row.GPSLat.Valid {
		lat = &row.GPSLat.Float64
	}
	if row.GPSLon.Valid {
		lon = &row.GPSLon.Float64
	}
	var description *string
	if row.Description.Valid && row.Description.String != "" {
		description = &row.Description.String
	}
	var placeCity, placeCountry *string
	if row.PlaceCity.Valid && row.PlaceCity.String != "" {
		placeCity = &row.PlaceCity.String
	}
	if row.PlaceCountry.Valid && row.PlaceCountry.String != "" {
		placeCountry = &row.PlaceCountry.String
	}
	originalURL := "/api/assets/" + row.ID + "/original"
	var thumbURL *string
	if row.ThumbPath.Valid {
		u := "/api/assets/" + row.ID + "/thumb"
		thumbURL = &u
	}
	return assetDTO{
		ID:           row.ID,
		Filename:     row.Filename,
		MimeType:     row.MimeType,
		MediaType:    row.MediaType,
		Width:        row.Width,
		Height:       row.Height,
		SizeBytes:    row.SizeBytes,
		TakenAt:      takenAt,
		TakenDay:     takenDay,
		TakenMonth:   takenMonth,
		CameraMake:   row.CameraMake,
		CameraModel:  row.CameraModel,
		GPSLat:       lat,
		GPSLon:       lon,
		DurationMS:   row.DurationMS,
		Favorite:     row.Favorite != 0,
		Description:  description,
		PlaceCity:    placeCity,
		PlaceCountry: placeCountry,
		OriginalURL:  originalURL,
		ThumbnailURL: thumbURL,
		CreatedAt:    row.CreatedAt,
	}
}

func serveStored(w http.ResponseWriter, r *http.Request, d Deps, rel, contentType, filename, cacheControl string) {
	if d.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "storage_unavailable")
		return
	}
	rc, err := d.Store.Open(r.Context(), rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "file_not_found")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", contentType)
	if cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
	}
	if filename != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, sanitizeHeaderFilename(filename)))
	}
	// When the backend yields a seeker (the filesystem does), use ServeContent so
	// HTTP Range requests work — required for in-browser video seeking (F-13).
	if rs, ok := rc.(io.ReadSeeker); ok {
		http.ServeContent(w, r, filename, time.Time{}, rs)
		return
	}
	if size, err := d.Store.Size(r.Context(), rel); err == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}

func parseLimit(raw string) int {
	if raw == "" {
		return defaultAssetLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultAssetLimit
	}
	return min(n, maxAssetLimit)
}

func encodeCursor(t, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t + "|" + id))
}

func decodeCursor(raw string) (string, string, error) {
	if raw == "" {
		return "", "", nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return "", "", err
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("bad cursor")
	}
	return parts[0], parts[1], nil
}

func ftsQuery(q string) string {
	parts := strings.Fields(q)
	if len(parts) == 0 {
		return `""`
	}
	for i, part := range parts {
		// Prefix match per term so "photo" finds "photo3.jpg" (F-09 filename search).
		parts[i] = `"` + strings.ReplaceAll(part, `"`, `""`) + `"*`
	}
	return strings.Join(parts, " AND ")
}

func sanitizeHeaderFilename(name string) string {
	name = strings.ReplaceAll(name, `"`, "")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	return name
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}
