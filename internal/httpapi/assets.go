package httpapi

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
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
	Rating       int      `json:"rating"`
	Archived     bool     `json:"archived"`
	Hidden       bool     `json:"hidden"`
	Description  *string  `json:"description,omitempty"`
	PlaceCity    *string  `json:"place_city,omitempty"`
	PlaceCountry *string  `json:"place_country,omitempty"`
	OriginalURL  string   `json:"original_url"`
	ThumbnailURL *string  `json:"thumbnail_url,omitempty"`
	PreviewURL   *string  `json:"preview_url,omitempty"`
	ViewURL      string   `json:"view_url"`
	WebViewable  bool     `json:"web_viewable"`
	StackID      *string  `json:"stack_id,omitempty"`
	StackSize    int      `json:"stack_size"`
	CreatedAt    string   `json:"created_at"`
}

type assetListResponse struct {
	Assets     []assetDTO `json:"assets"`
	NextCursor string     `json:"next_cursor,omitempty"`
}

type assetRow struct {
	ID           string
	OriginalPath string
	ExternalPath sql.NullString
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
	Rating       int
	Archived     int
	Hidden       int
	CreatedAt    string
	Description  sql.NullString
	PlaceCity    sql.NullString
	PlaceCountry sql.NullString
	ThumbPath    sql.NullString
	PreviewPath  sql.NullString
	WebViewable  int
	StackID      sql.NullString
	StackSize    int
}

func (d Deps) listAssets(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"))
	cursorTime, cursorID, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}

	args := []any{}
	where := "deleted_at IS NULL AND archived = 0 AND hidden = 0"
	if r.URL.Query().Get("archived") == "1" {
		where = "deleted_at IS NULL AND archived = 1 AND hidden = 0"
	}
	if r.URL.Query().Get("hidden") == "1" {
		where = "deleted_at IS NULL AND hidden = 1"
	}
	// Collapse stacks: show only the primary of each stack in the timeline.
	where += " AND (stack_id IS NULL OR stack_primary = 1)"
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

// searchAssets is the unified filter endpoint (the "one filter language"). It
// shares its whole implementation with the mobile library via respondFiltered.
func (d Deps) searchAssets(w http.ResponseWriter, r *http.Request) {
	d.respondFiltered(w, r)
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
	if row.ExternalPath.Valid {
		f, err := os.Open(row.ExternalPath.String)
		if err != nil {
			writeError(w, http.StatusNotFound, "external_file_not_found")
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", row.MimeType)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, sanitizeHeaderFilename(row.Filename)))
		http.ServeContent(w, r, row.Filename, time.Time{}, f)
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
	contentType := derivativeContentType(format)
	// Thumbnails are stable per asset; cache for a week so the timeline scrolls
	// without re-fetching.
	serveStored(w, r, d, "derivatives/"+rel, contentType, filepath.Base(rel),
		"private, max-age=604800")
}

func (d Deps) servePreview(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := d.lookupAsset(r, id); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "query_asset_failed")
		return
	}
	var rel, format string
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT path, format FROM derivatives WHERE asset_id = ? AND kind = 'preview'`, id).Scan(&rel, &format)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "preview_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_preview_failed")
		return
	}
	serveStored(w, r, d, "derivatives/"+rel, derivativeContentType(format), filepath.Base(rel),
		"private, max-age=604800")
}

func derivativeContentType(format string) string {
	switch format {
	case "webp":
		return "image/webp"
	case "mp4":
		return "video/mp4"
	default:
		return "image/jpeg"
	}
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
			a.id, a.original_path, a.external_path, a.filename, a.mime_type, a.media_type,
			a.width, a.height, a.size_bytes, a.taken_at, a.camera_make,
			a.camera_model, a.gps_lat, a.gps_lon, a.duration_ms, a.favorite, a.rating, a.archived, a.hidden,
			a.created_at, a.description, a.place_city, a.place_country, COALESCE(d_thumb.path, d_poster.path),
			d_preview.path, a.web_viewable, a.stack_id,
			(SELECT COUNT(*) FROM assets s WHERE s.stack_id = a.stack_id AND s.deleted_at IS NULL)
		FROM assets a
		LEFT JOIN derivatives d_thumb ON d_thumb.asset_id = a.id AND d_thumb.kind = 'thumb'
		LEFT JOIN derivatives d_poster ON d_poster.asset_id = a.id AND d_poster.kind = 'poster'
		LEFT JOIN derivatives d_preview ON d_preview.asset_id = a.id AND d_preview.kind = 'preview'
		` + join + `
		` + where + `
		ORDER BY COALESCE(a.taken_at, a.created_at) DESC, a.id DESC`
}

func assetScanDest(row *assetRow) []any {
	return []any{
		&row.ID, &row.OriginalPath, &row.ExternalPath, &row.Filename, &row.MimeType, &row.MediaType,
		&row.Width, &row.Height, &row.SizeBytes, &row.TakenAt, &row.CameraMake,
		&row.CameraModel, &row.GPSLat, &row.GPSLon, &row.DurationMS, &row.Favorite, &row.Rating, &row.Archived, &row.Hidden,
		&row.CreatedAt, &row.Description, &row.PlaceCity, &row.PlaceCountry, &row.ThumbPath,
		&row.PreviewPath, &row.WebViewable, &row.StackID, &row.StackSize,
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
	var previewURL *string
	if row.PreviewPath.Valid {
		u := "/api/assets/" + row.ID + "/preview"
		previewURL = &u
	}
	viewURL := originalURL
	if previewURL != nil {
		viewURL = *previewURL
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
		Rating:       row.Rating,
		Archived:     row.Archived != 0,
		Hidden:       row.Hidden != 0,
		Description:  description,
		PlaceCity:    placeCity,
		PlaceCountry: placeCountry,
		OriginalURL:  originalURL,
		ThumbnailURL: thumbURL,
		PreviewURL:   previewURL,
		ViewURL:      viewURL,
		WebViewable:  row.WebViewable != 0,
		StackSize:    row.StackSize,
		StackID: func() *string {
			if row.StackID.Valid {
				return &row.StackID.String
			}
			return nil
		}(),
		CreatedAt: row.CreatedAt,
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
