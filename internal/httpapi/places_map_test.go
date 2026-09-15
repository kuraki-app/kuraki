package httpapi

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

func seedMapAsset(t *testing.T, database *sql.DB, id, owner string, lat, lon float64) {
	t.Helper()
	seedOwnedAssetFor(t, database, id, owner)
	if _, err := database.Exec(`UPDATE assets SET gps_lat = ?, gps_lon = ? WHERE id = ?`, lat, lon, id); err != nil {
		t.Fatal(err)
	}
}

func TestPlacesMapAssetsAreBoundedAndOwnerScoped(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	owner := soleOwnerID(t, database)
	seedMapAsset(t, database, "paris-a", owner, 48.85, 2.35)
	seedMapAsset(t, database, "paris-b", owner, 48.86, 2.36)
	other := secondOwner(t, database)
	seedMapAsset(t, database, "berlin", other, 52.52, 13.40)

	result := getJSONWithCookie[apitypes.PlaceMap](t, router,
		"/api/places/map?bbox=2,48,3,49&zoom=12&limit=1", cookie)
	if !result.Truncated || len(result.Features) != 1 {
		t.Fatalf("asset map = %+v, want one truncated own feature", result)
	}
	feature := result.Features[0]
	if feature.Properties.Kind != "asset" || feature.Properties.AssetID != "paris-a" {
		t.Fatalf("asset feature = %+v, want paris-a only", feature)
	}
	if feature.Geometry.Coordinates[0] < 2 || feature.Geometry.Coordinates[0] > 3 {
		t.Fatalf("asset coordinate leaked outside requested viewport: %+v", feature.Geometry)
	}
}

func TestPlacesMapClustersAndRejectsInvalidQueries(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	owner := soleOwnerID(t, database)
	seedMapAsset(t, database, "near-a", owner, 48.85, 2.35)
	seedMapAsset(t, database, "near-b", owner, 48.86, 2.36)

	result := getJSONWithCookie[apitypes.PlaceMap](t, router,
		"/api/places/map?bbox=2,48,3,49&zoom=4", cookie)
	if len(result.Features) != 1 || result.Features[0].Properties.Kind != "cluster" || result.Features[0].Properties.Count != 2 {
		t.Fatalf("cluster map = %+v, want one two-asset cluster", result)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/places/map?bbox=bad&zoom=4", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid map request = %d body=%s, want 400", rec.Code, rec.Body.String())
	}
}
