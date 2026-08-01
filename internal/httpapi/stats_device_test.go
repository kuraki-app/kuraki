package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// getStats issues GET /api/stats as whichever principal the caller supplies.
func getStats(t *testing.T, router http.Handler, token string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// TestStatsReachableByDevicePrincipal pins the routing fact the mobile Settings
// screen depends on: /api/stats sits in the "reachable by BOTH principals"
// group, so a paired device can read its owner's library totals with nothing
// but its bearer token. The handler already resolves the owner through
// ownerID(r), so this needs no device-specific route — and this test is what
// stops one being added, or the route drifting into the session-only group.
func TestStatsReachableByDevicePrincipal(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, database, "stats-asset-1")

	rec := getStats(t, router, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("device stats status = %d body=%s", rec.Code, rec.Body.String())
	}

	var got apitypes.LibraryStats
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if got.Total != 1 {
		t.Fatalf("device stats total = %d, want 1", got.Total)
	}
	if got.Images != 1 {
		t.Fatalf("device stats images = %d, want 1", got.Images)
	}
}

// TestStatsRejectsUnauthenticated proves the route is not simply public.
func TestStatsRejectsUnauthenticated(t *testing.T) {
	router, _, _ := deviceFavoriteRouter(t)

	if rec := getStats(t, router, "", nil); rec.Code == http.StatusOK {
		t.Fatalf("stats served without credentials: status = %d", rec.Code)
	}
	if rec := getStats(t, router, "not-a-real-token", nil); rec.Code == http.StatusOK {
		t.Fatalf("stats served to a bogus device token: status = %d", rec.Code)
	}
}

// TestStatsAgreesAcrossPrincipals proves the device and the owner's browser see
// the same library, which is the point of resolving through ownerID(r).
func TestStatsAgreesAcrossPrincipals(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, database, "stats-asset-a")
	seedOwnedAsset(t, database, "stats-asset-b")

	var viaDevice, viaSession apitypes.LibraryStats
	if err := json.Unmarshal(getStats(t, router, token, nil).Body.Bytes(), &viaDevice); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(getStats(t, router, "", cookie).Body.Bytes(), &viaSession); err != nil {
		t.Fatal(err)
	}
	// LibraryStats carries a []YearCount, so it is not comparable with !=.
	if !reflect.DeepEqual(viaDevice, viaSession) {
		t.Fatalf("device stats %+v != session stats %+v", viaDevice, viaSession)
	}
	if viaDevice.Total != 2 {
		t.Fatalf("total = %d, want 2", viaDevice.Total)
	}
}
