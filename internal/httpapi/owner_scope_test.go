package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// secondOwner inserts a second users row (distinct id, non-empty
// password_hash) so cross-owner isolation tests have two tenants, and
// returns its id.
func secondOwner(t *testing.T, database *sql.DB) string {
	t.Helper()
	const id = "owner-b"
	if _, err := database.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`,
		id, "owner-b", "x"); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedOwnedAssetFor inserts a minimal asset owned by an arbitrary owner. Like
// seedOwnedAsset (favorites_device_test.go) but for a caller-supplied owner
// rather than the sole Phase-1 user.
func seedOwnedAssetFor(t *testing.T, database *sql.DB, id, ownerID string) {
	t.Helper()
	_, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
		VALUES (?, ?, ?, ?, ?, ?, 'image')`, id, ownerID, "hash-"+id, "2026/07/"+id+".jpg", id+".jpg", "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
}

// patchJSON issues a PATCH with a JSON body, mirroring postJSON (auth_test.go).
func patchJSON(t *testing.T, handler http.Handler, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	return methodJSON(t, handler, http.MethodPatch, path, body, cookie)
}

// putJSON issues a PUT with a JSON body, mirroring postJSON (auth_test.go).
func putJSON(t *testing.T, handler http.Handler, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	return methodJSON(t, handler, http.MethodPut, path, body, cookie)
}

func methodJSON(t *testing.T, handler http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// TestPatchAssetOwnerScoped proves a caller cannot edit an asset they do not own.
func TestPatchAssetOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other) // owned by someone else
	desc := "hacked"
	rec := patchJSON(t, router, "/api/assets/b1", apitypes.AssetPatch{Description: &desc}, cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("patch of other-owner asset = %d, want 404", rec.Code)
	}

	// The happy path must still work: caller editing their own asset succeeds.
	seedOwnedAsset(t, db, "a1")
	rec = patchJSON(t, router, "/api/assets/a1", apitypes.AssetPatch{Description: &desc}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch of own asset = %d body=%s, want 200", rec.Code, rec.Body.String())
	}
}

// TestReplaceTagsOwnerScoped proves a caller cannot retag an asset they do not own.
func TestReplaceTagsOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	rec := putJSON(t, router, "/api/assets/b1/tags", apitypes.AssetTagsRequest{IDs: []string{}}, cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("PUT tags of other-owner asset = %d, want 404", rec.Code)
	}
}

// TestBatchFavoriteOwnerScoped proves a batch favorite op reports a
// non-owned id as failed while still applying to the caller's own assets.
func TestBatchFavoriteOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")

	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "favorite", IDs: []string{"a1", "b1"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch favorite = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.BatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Succeeded != 1 {
		t.Fatalf("succeeded = %d, want 1", resp.Succeeded)
	}
	if _, failed := resp.Failed["b1"]; !failed {
		t.Fatalf("expected b1 (other owner's asset) in failed map, got %+v", resp.Failed)
	}

	// The other owner's asset must remain unfavorited.
	var fav int
	if err := db.QueryRow(`SELECT favorite FROM assets WHERE id = 'b1'`).Scan(&fav); err != nil {
		t.Fatal(err)
	}
	if fav != 0 {
		t.Fatalf("b1 favorite = %d, want 0 (untouched)", fav)
	}
}

// TestBatchDeleteOwnerScoped proves a batch delete op cannot trash another
// owner's asset via the multi-select endpoint (unlike the single-asset
// deleteAsset handler, batchAssets did not check ownership before routing
// straight into trash.Delete). Uses deviceTrashTestRouter/seedOwnedAssetFile
// (parity_device_test.go) rather than deviceFavoriteRouter/seedOwnedAssetFor
// because trash.Delete moves a real file on disk — without a physical
// original, the delete would fail on the file-move step regardless of the
// ownership check, making the test a false negative either way.
func TestBatchDeleteOwnerScoped(t *testing.T) {
	ctx := context.Background()
	router, cookie, db, store := deviceTrashTestRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	if _, err := store.Write(ctx, "originals/2026/07/b1.jpg", strings.NewReader("bytes-b1")); err != nil {
		t.Fatal(err)
	}

	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "delete", IDs: []string{"b1"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch delete = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.BatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Succeeded != 0 {
		t.Fatalf("succeeded = %d, want 0", resp.Succeeded)
	}
	if _, failed := resp.Failed["b1"]; !failed {
		t.Fatalf("expected b1 (other owner's asset) in failed map, got %+v", resp.Failed)
	}

	// The other owner's asset must remain un-deleted.
	var deletedAt sql.NullString
	if err := db.QueryRow(`SELECT deleted_at FROM assets WHERE id = 'b1'`).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if deletedAt.Valid {
		t.Fatalf("b1 deleted_at = %q, want NULL (untouched)", deletedAt.String)
	}
}

// TestListAssetsOwnerScoped proves the library listing never surfaces
// another owner's assets.
func TestListAssetsOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")

	list := getJSONWithCookie[apitypes.AssetList](t, router, "/api/assets", cookie)
	for _, a := range list.Assets {
		if a.ID == "b1" {
			t.Fatalf("listAssets leaked other owner's asset b1: %+v", list.Assets)
		}
	}
	found := false
	for _, a := range list.Assets {
		if a.ID == "a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("listAssets missing caller's own asset a1: %+v", list.Assets)
	}
}

// TestListTrashOwnerScoped proves the trash listing never surfaces another
// owner's trashed assets.
func TestListTrashOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")
	if _, err := db.Exec(`UPDATE assets SET deleted_at = ? WHERE id IN ('a1','b1')`, time.Now().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}

	list := getJSONWithCookie[apitypes.AssetList](t, router, "/api/trash", cookie)
	for _, a := range list.Assets {
		if a.ID == "b1" {
			t.Fatalf("listTrash leaked other owner's asset b1: %+v", list.Assets)
		}
	}
	found := false
	for _, a := range list.Assets {
		if a.ID == "a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("listTrash missing caller's own trashed asset a1: %+v", list.Assets)
	}
}

// TestOnThisDayOwnerScoped proves memories never surface another owner's assets.
func TestOnThisDayOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")
	takenAt := "2020-" + time.Now().Format("01-02") + "T12:00:00Z"
	if _, err := db.Exec(`UPDATE assets SET taken_at = ? WHERE id IN ('a1','b1')`, takenAt); err != nil {
		t.Fatal(err)
	}

	list := getJSONWithCookie[apitypes.AssetList](t, router, "/api/memories", cookie)
	for _, a := range list.Assets {
		if a.ID == "b1" {
			t.Fatalf("onThisDay leaked other owner's asset b1: %+v", list.Assets)
		}
	}
	found := false
	for _, a := range list.Assets {
		if a.ID == "a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("onThisDay missing caller's own asset a1: %+v", list.Assets)
	}
}

// TestSearchOwnerScoped proves respondFiltered (backing /api/search, reachable
// by both principals) never surfaces another owner's assets. It exercises the
// route via a device token since that is the currently reachable path for a
// cross-tenant leak via a paired device token.
func TestSearchOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")

	// The device is registered by the default session owner, not secondOwner.
	token := registerTestDevice(t, router, cookie)
	lib := getWithBearer[apitypes.AssetList](t, router, "/api/search", token)
	for _, a := range lib.Assets {
		if a.ID == "b1" {
			t.Fatalf("respondFiltered leaked other owner's asset b1: %+v", lib.Assets)
		}
	}
	found := false
	for _, a := range lib.Assets {
		if a.ID == "a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("respondFiltered missing caller's own asset a1: %+v", lib.Assets)
	}
}

// TestDownloadZipOwnerScoped proves a zip download request cannot include
// another owner's assets, even if their ids are known.
func TestDownloadZipOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)

	// Attempt to zip-download the other owner's asset by id.
	rec := postJSON(t, router, "/api/assets/zip", apitypes.ZipRequest{IDs: []string{"b1"}}, cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("zip download of other-owner asset = %d, want 404", rec.Code)
	}
}

// TestFavoritesOwnerScoped proves listFavorites never surfaces another
// owner's favorited assets.
func TestFavoritesOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")
	if _, err := db.Exec(`UPDATE assets SET favorite = 1 WHERE id IN ('a1','b1')`); err != nil {
		t.Fatal(err)
	}

	list := getJSONWithCookie[apitypes.AssetList](t, router, "/api/favorites", cookie)
	for _, a := range list.Assets {
		if a.ID == "b1" {
			t.Fatalf("listFavorites leaked other owner's favorited asset b1: %+v", list.Assets)
		}
	}
	found := false
	for _, a := range list.Assets {
		if a.ID == "a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("listFavorites missing caller's own favorited asset a1: %+v", list.Assets)
	}
}

// --- Deferred owner-scoping surfaces (AGENTS.md §11 unified-auth handoff) ---
//
// These seven surfaces were left library-wide as "harmless in single-owner".
// Each test below proves the surface no longer observes another owner's data.

// getRawWithCookie issues a GET and returns the recorder without asserting on
// the status, for tests that care about the status code itself.
func getRawWithCookie(t *testing.T, handler http.Handler, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// soleOwnerID returns the id of the account created by setupTestSession --
// the owner behind deviceFavoriteRouter's cookie. Call it before secondOwner
// so the "first row" lookup is unambiguous.
func soleOwnerID(t *testing.T, database *sql.DB) string {
	t.Helper()
	var id string
	if err := database.QueryRow(`SELECT id FROM users ORDER BY created_at, rowid LIMIT 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedPlacedAssetFor inserts an asset carrying GPS + a resolved place, so the
// places and stats aggregations have something to group.
func seedPlacedAssetFor(t *testing.T, database *sql.DB, id, ownerID, city, country string) {
	t.Helper()
	seedOwnedAssetFor(t, database, id, ownerID)
	if _, err := database.Exec(
		`UPDATE assets SET gps_lat = 48.85, gps_lon = 2.35, place_city = ?, place_country = ? WHERE id = ?`,
		city, country, id); err != nil {
		t.Fatal(err)
	}
}

// TestStackSizeOwnerScoped proves the stack_size count subquery in
// assetSelectSQL does not count another owner's asset sharing a stack_id.
func TestStackSizeOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	if _, err := db.Exec(`UPDATE assets SET stack_id = 'st1' WHERE id IN ('a1','b1')`); err != nil {
		t.Fatal(err)
	}

	got := getJSONWithCookie[apitypes.Asset](t, router, "/api/assets/a1", cookie)
	if got.StackSize != 1 {
		t.Fatalf("stack_size = %d, want 1 (other owner's stack member must not count)", got.StackSize)
	}
}

// TestStatsOwnerScoped proves the dashboard totals count only the caller's
// library -- assets, trash, albums, places and the year histogram.
func TestStatsOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedPlacedAssetFor(t, db, "a1", soleOwnerID(t, db), "Paris", "France")
	other := secondOwner(t, db)
	seedPlacedAssetFor(t, db, "b1", other, "Berlin", "Germany")
	seedPlacedAssetFor(t, db, "b2", other, "Berlin", "Germany")
	if _, err := db.Exec(`UPDATE assets SET deleted_at = '2026-07-01T00:00:00Z' WHERE id = 'b2'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO albums (id, owner_id, name) VALUES ('alb-b', ?, 'theirs')`, other); err != nil {
		t.Fatal(err)
	}

	s := getJSONWithCookie[apitypes.LibraryStats](t, router, "/api/stats", cookie)
	if s.Total != 1 {
		t.Fatalf("total = %d, want 1 (only the caller's asset)", s.Total)
	}
	if s.Trashed != 0 {
		t.Fatalf("trashed = %d, want 0 (other owner's trashed asset must not count)", s.Trashed)
	}
	if s.Albums != 0 {
		t.Fatalf("albums = %d, want 0 (other owner's album must not count)", s.Albums)
	}
	if s.Places != 1 {
		t.Fatalf("places = %d, want 1 (Berlin belongs to the other owner)", s.Places)
	}
	var total int
	for _, y := range s.ByYear {
		total += y.Count
	}
	if total != 1 {
		t.Fatalf("by_year total = %d, want 1", total)
	}
}

// TestPlacesOwnerScoped proves neither the places map feed nor the places
// summary surfaces another owner's geotagged assets.
func TestPlacesOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedPlacedAssetFor(t, db, "a1", soleOwnerID(t, db), "Paris", "France")
	other := secondOwner(t, db)
	seedPlacedAssetFor(t, db, "b1", other, "Berlin", "Germany")

	list := getJSONWithCookie[apitypes.AssetList](t, router, "/api/places", cookie)
	for _, a := range list.Assets {
		if a.ID == "b1" {
			t.Fatalf("/api/places leaked other owner's asset b1: %+v", list.Assets)
		}
	}
	if len(list.Assets) != 1 {
		t.Fatalf("/api/places returned %d assets, want 1", len(list.Assets))
	}

	summary := getJSONWithCookie[apitypes.PlaceSummary](t, router, "/api/places/summary", cookie)
	for _, g := range summary.Places {
		if g.City == "Berlin" {
			t.Fatalf("/api/places/summary leaked other owner's place: %+v", summary.Places)
		}
	}
	if len(summary.Places) != 1 {
		t.Fatalf("/api/places/summary returned %d groups, want 1", len(summary.Places))
	}
}

// TestStackAssetsOwnerScoped proves the stack view cannot enumerate another
// owner's stack, even when the caller guesses a stacked asset id.
func TestStackAssetsOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAssetFor(t, db, "b2", other)
	if _, err := db.Exec(`UPDATE assets SET stack_id = 'st-b' WHERE id IN ('b1','b2')`); err != nil {
		t.Fatal(err)
	}

	rec := getRawWithCookie(t, router, "/api/assets/b1/stack", cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("stack of other-owner asset = %d body=%s, want 404", rec.Code, rec.Body.String())
	}
}

// TestMediaIssuesOwnerScoped proves the media-health list shows only the
// caller's broken derivatives.
func TestMediaIssuesOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	if _, err := db.Exec(
		`INSERT INTO media_issues (asset_id, kind, message) VALUES ('b1','thumbnail','boom')`); err != nil {
		t.Fatal(err)
	}

	list := getJSONWithCookie[apitypes.MediaIssueList](t, router, "/api/media/issues", cookie)
	for _, issue := range list.Issues {
		if issue.AssetID == "b1" {
			t.Fatalf("media issues leaked other owner's asset: %+v", list.Issues)
		}
	}
}

// TestRebuildAssetOwnerScoped proves a caller cannot trigger a derivative
// rebuild on an asset they do not own.
func TestRebuildAssetOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)

	rec := postJSON(t, router, "/api/assets/b1/rebuild", nil, cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("rebuild of other-owner asset = %d body=%s, want 404", rec.Code, rec.Body.String())
	}
}

// TestExportLibraryOwnerScoped proves the whole-library export contains only
// the caller's originals. The other owner's asset has no file on disk, so
// before scoping the export reached prepareZip and failed 409
// original_unavailable; after scoping the caller's library is empty (404).
func TestExportLibraryOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)

	rec := getRawWithCookie(t, router, "/api/export", cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("export with only another owner's assets = %d body=%s, want 404 no_assets",
			rec.Code, rec.Body.String())
	}
}
