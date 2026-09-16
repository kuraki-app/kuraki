package httpapi

import (
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

const (
	defaultPlacesMapLimit = 1000
	maxPlacesMapLimit     = 2000
	assetZoomThreshold    = 12
)

// placesAssets returns every non-deleted asset that carries GPS, for plotting on
// the map. It reuses the standard asset DTO (which includes gps + thumbnail).
// @Summary List assets with GPS
// @Tags    places
// @Produce json
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Router  /api/places [get]
func (d Deps) placesAssets(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL("WHERE a.owner_id = ? AND a.deleted_at IS NULL AND a.gps_lat IS NOT NULL AND a.gps_lon IS NOT NULL")+" LIMIT 5000",
		owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_places_failed")
		return
	}
	defer rows.Close()
	assets, _, err := scanAssetRows(rows, 5000)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_places_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets})
}

// placesSummary groups assets by resolved place so the UI can show a list of
// places with counts and a cover thumbnail (e.g. "Paris, France · 128").
// @Summary Places summary
// @Tags    places
// @Produce json
// @Success 200 {object} apitypes.PlaceSummary
// @Failure 401 {object} apitypes.Error
// @Router  /api/places/summary [get]
func (d Deps) placesSummary(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT place_city, COALESCE(place_country,''), COUNT(*), MAX(id)
		FROM assets
		WHERE owner_id = ? AND deleted_at IS NULL AND place_city IS NOT NULL AND place_city <> ''
		GROUP BY place_country, place_city
		ORDER BY COUNT(*) DESC, place_city ASC`, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_places_summary_failed")
		return
	}
	defer rows.Close()

	groups := make([]apitypes.PlaceGroup, 0)
	for rows.Next() {
		var g apitypes.PlaceGroup
		if err := rows.Scan(&g.City, &g.Country, &g.Count, &g.CoverAssetID); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_places_summary_failed")
			return
		}
		g.CoverThumbURL = "/api/assets/" + g.CoverAssetID + "/thumb"
		groups = append(groups, g)
	}
	writeJSON(w, http.StatusOK, apitypes.PlaceSummary{Places: groups})
}

// placesMap returns a bounded GeoJSON feed for one viewport. Lower zooms are
// grouped into server-side cells so a whole-library view does not ship every
// coordinate; close views return minimal asset points.
// @Summary Map features for a viewport
// @Tags    places
// @Produce json
// @Param   bbox query string true "min longitude,min latitude,max longitude,max latitude"
// @Param   zoom query number true "map zoom (0-22)"
// @Param   limit query int false "maximum features (1-2000)" default(1000)
// @Success 200 {object} apitypes.PlaceMap
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/places/map [get]
func (d Deps) placesMap(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	query, code := parsePlacesMapQuery(r)
	if code != "" {
		writeError(w, http.StatusBadRequest, code)
		return
	}

	features, truncated, err := d.queryPlacesMap(r, owner, query)
	if err != nil {
		if d.Logger != nil {
			d.Logger.Error("places map query failed", "owner", owner, "zoom", query.zoom, "err", err)
		}
		writeError(w, http.StatusInternalServerError, "query_places_map_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.PlaceMap{
		Type: "FeatureCollection", Features: features, Truncated: truncated,
	})
}

type placesMapQuery struct {
	minLon, minLat float64
	maxLon, maxLat float64
	zoom           float64
	limit          int
}

func parsePlacesMapQuery(r *http.Request) (placesMapQuery, string) {
	var out placesMapQuery
	parts := strings.Split(r.URL.Query().Get("bbox"), ",")
	if len(parts) != 4 {
		return out, "invalid_bbox"
	}
	values := make([]float64, 4)
	for i, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return out, "invalid_bbox"
		}
		values[i] = value
	}
	out.minLon, out.minLat, out.maxLon, out.maxLat = values[0], values[1], values[2], values[3]
	if out.minLon < -180 || out.maxLon > 180 || out.minLat < -90 || out.maxLat > 90 ||
		out.minLon >= out.maxLon || out.minLat >= out.maxLat {
		return placesMapQuery{}, "invalid_bbox"
	}
	zoom, err := strconv.ParseFloat(r.URL.Query().Get("zoom"), 64)
	if err != nil || math.IsNaN(zoom) || math.IsInf(zoom, 0) || zoom < 0 || zoom > 22 {
		return placesMapQuery{}, "invalid_zoom"
	}
	out.zoom = zoom
	out.limit = defaultPlacesMapLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPlacesMapLimit {
			return placesMapQuery{}, "invalid_limit"
		}
		out.limit = limit
	}
	return out, ""
}

func (d Deps) queryPlacesMap(r *http.Request, owner string, q placesMapQuery) ([]apitypes.PlaceMapFeature, bool, error) {
	if q.zoom >= assetZoomThreshold {
		rows, err := d.DB.QueryContext(r.Context(), `
			SELECT id, gps_lon, gps_lat
			FROM assets
			WHERE owner_id = ? AND deleted_at IS NULL
			  AND gps_lat >= ? AND gps_lat <= ? AND gps_lon >= ? AND gps_lon <= ?
			ORDER BY id
			LIMIT ?`, owner, q.minLat, q.maxLat, q.minLon, q.maxLon, q.limit+1)
		if err != nil {
			return nil, false, fmt.Errorf("places: query asset points: %w", err)
		}
		return scanPlaceMapRows(rows, q.limit, true)
	}

	// Web Mercator zoom doubles resolution per level. Eight longitude cells at
	// zoom zero keep the overview useful while still shrinking dense libraries.
	cellSize := 360 / math.Pow(2, q.zoom+3)
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE '' END,
		       AVG(gps_lon), AVG(gps_lat), COUNT(*)
		FROM assets
		WHERE owner_id = ? AND deleted_at IS NULL
		  AND gps_lat >= ? AND gps_lat <= ? AND gps_lon >= ? AND gps_lon <= ?
		GROUP BY CAST((gps_lon + 180.0) / ? AS INTEGER),
		         CAST((gps_lat + 90.0) / ? AS INTEGER)
		ORDER BY COUNT(*) DESC
		LIMIT ?`, owner, q.minLat, q.maxLat, q.minLon, q.maxLon, cellSize, cellSize, q.limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("places: query cluster points: %w", err)
	}
	return scanPlaceMapRows(rows, q.limit, false)
}

func scanPlaceMapRows(rows *sql.Rows, limit int, assetsOnly bool) ([]apitypes.PlaceMapFeature, bool, error) {
	defer rows.Close()
	features := make([]apitypes.PlaceMapFeature, 0, limit)
	truncated := false
	for rows.Next() {
		var id string
		var lon, lat float64
		count := 1
		if assetsOnly {
			if err := rows.Scan(&id, &lon, &lat); err != nil {
				return nil, false, fmt.Errorf("places: scan asset point: %w", err)
			}
		} else if err := rows.Scan(&id, &lon, &lat, &count); err != nil {
			return nil, false, fmt.Errorf("places: scan cluster point: %w", err)
		}
		if len(features) == limit {
			truncated = true
			continue
		}
		kind := "asset"
		if count > 1 {
			kind = "cluster"
			id = ""
		}
		features = append(features, apitypes.PlaceMapFeature{
			Type:     "Feature",
			Geometry: apitypes.PlaceMapGeometry{Type: "Point", Coordinates: [2]float64{lon, lat}},
			Properties: apitypes.PlaceMapProperties{
				Kind: kind, Count: count, AssetID: id,
			},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("places: iterate map points: %w", err)
	}
	return features, truncated, nil
}
