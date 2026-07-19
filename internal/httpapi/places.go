package httpapi

import (
	"net/http"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// placesAssets returns every non-deleted asset that carries GPS, for plotting on
// the map. It reuses the standard asset DTO (which includes gps + thumbnail).
func (d Deps) placesAssets(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL("WHERE a.deleted_at IS NULL AND a.gps_lat IS NOT NULL AND a.gps_lon IS NOT NULL")+" LIMIT 5000")
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
func (d Deps) placesSummary(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT place_city, COALESCE(place_country,''), COUNT(*), MAX(id)
		FROM assets
		WHERE deleted_at IS NULL AND place_city IS NOT NULL AND place_city <> ''
		GROUP BY place_country, place_city
		ORDER BY COUNT(*) DESC, place_city ASC`)
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
