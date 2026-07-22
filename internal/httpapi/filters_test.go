package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

func TestUnifiedFiltersAndDeviceSearch(t *testing.T) {
	ctx := context.Background()
	database, store, _ := seedHTTPAsset(t, ctx)
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	var id string
	if err := database.QueryRowContext(ctx, `SELECT id FROM assets`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `
		UPDATE assets SET favorite = 1, rating = 4, place_city = 'Kyoto', place_country = 'Japan' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}

	var owner string
	if err := database.QueryRowContext(ctx, `SELECT owner_id FROM assets WHERE id = ?`, id).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO tags(id, owner_id, name) VALUES('tag-beach', ?, 'Beach')`, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO asset_tags(asset_id, tag_id) VALUES(?, 'tag-beach')`, id); err != nil {
		t.Fatal(err)
	}

	cases := map[string]int{
		"/api/search?tag=tag-beach":         1,
		"/api/search?tag=tag-missing":       0,
		"/api/search":                       1,
		"/api/search?favorite=1":            1,
		"/api/search?type=image":            1,
		"/api/search?type=video":            0,
		"/api/search?rating=4":              1,
		"/api/search?rating=1":              0,
		"/api/search?place_city=Kyoto":      1,
		"/api/search?place_city=Osaka":      0,
		"/api/search?place_country=Japan":   1,
		"/api/search?q=IMG_0001&favorite=1": 1,
	}
	for path, want := range cases {
		got := getJSONWithCookie[apitypes.AssetList](t, router, path, cookie)
		if len(got.Assets) != want {
			t.Errorf("%s returned %d assets, want %d", path, len(got.Assets), want)
		}
	}

	// An invalid rating is a bad request, not a silent match.
	badReq := httptest.NewRequest(http.MethodGet, "/api/search?rating=9", nil)
	badReq.AddCookie(cookie)
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("rating=9 status = %d, want 400", badRec.Code)
	}

	// The same filters are reachable with a device token (mobile parity):
	// /api/search is a both-principals route.
	deviceRec := postJSON(t, router, "/api/devices", apitypes.DeviceRequest{Name: "Phone"}, cookie)
	var device apitypes.DeviceResponse
	if err := json.Unmarshal(deviceRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}
	lib := getWithBearer[apitypes.AssetList](t, router, "/api/search?favorite=1", device.Token)
	if len(lib.Assets) != 1 || lib.Assets[0].ID != id {
		t.Fatalf("device search = %+v, want the favorited asset", lib)
	}

	// The device can fetch a thumbnail with its token.
	thumbReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+id+"/thumb", nil)
	thumbReq.Header.Set("Authorization", "Bearer "+device.Token)
	thumbRec := httptest.NewRecorder()
	router.ServeHTTP(thumbRec, thumbReq)
	if thumbRec.Code != http.StatusOK {
		t.Fatalf("device thumb status = %d, want 200", thumbRec.Code)
	}

	// Without a token it is rejected.
	noAuth := httptest.NewRequest(http.MethodGet, "/api/search", nil)
	noAuthRec := httptest.NewRecorder()
	router.ServeHTTP(noAuthRec, noAuth)
	if noAuthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth search status = %d, want 401", noAuthRec.Code)
	}
}

func getWithBearer[T any](t *testing.T, handler http.Handler, path, token string) T {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d: %s", path, rec.Code, rec.Body.String())
	}
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return out
}
