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

// TestSearchOwnerScoped proves respondFiltered (backing both /api/search and
// the device-authenticated /api/capture/library) never surfaces another
// owner's assets. It exercises the device route since that is the currently
// reachable path for a cross-tenant leak via a paired device token.
func TestSearchOwnerScoped(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAsset(t, db, "a1")

	// The device is registered by the default session owner, not secondOwner.
	token := registerTestDevice(t, router, cookie)
	lib := getWithBearer[apitypes.AssetList](t, router, "/api/capture/library", token)
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
