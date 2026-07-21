package httpapi

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
