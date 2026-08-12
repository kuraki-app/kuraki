package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// These cover three capabilities the server either could not perform at all or
// could only perform one asset at a time, each of which left a gap the web UI
// could not close.

// TestBatchPurgeRemovesAssetsPermanently proves the batch `purge` op empties the
// trash in one request. DELETE /api/trash/{id} already existed, but emptying a
// trash of 500 items through it means 500 requests.
func TestBatchPurgeRemovesAssetsPermanently(t *testing.T) {
	ctx := context.Background()
	// The store-carrying router: trash.Delete MOVES the original on disk, so an
	// asset row with no file behind it fails to reach the trash at all.
	router, cookie, database, store := deviceTrashTestRouter(t)
	seedOwnedAssetFile(t, ctx, database, store, "p1")
	seedOwnedAssetFile(t, ctx, database, store, "p2")

	// purge only applies to assets already in the trash.
	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "delete", IDs: []string{"p1", "p2"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", rec.Code, rec.Body.String())
	}
	var deleted apitypes.BatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &deleted); err != nil {
		t.Fatal(err)
	}
	// Checked explicitly: /assets/batch answers 200 even when every item failed,
	// so trusting the status code alone would make the purge assertions below
	// test nothing at all.
	if deleted.Succeeded != 2 {
		t.Fatalf("delete succeeded=%d failed=%v; the purge below would be meaningless", deleted.Succeeded, deleted.Failed)
	}

	// Counted before the purge, because trashing an asset ALSO logs a 'delete'
	// change (the client has to drop it from the timeline either way). What this
	// test is about is whether the purge logs its own.
	changesBefore := countDeleteChanges(t, database)

	rec = postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "purge", IDs: []string{"p1", "p2"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("purge status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.BatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Succeeded != 2 {
		t.Fatalf("purged %d assets, want 2 (failed: %v)", resp.Succeeded, resp.Failed)
	}

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM assets WHERE id IN ('p1','p2')`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("%d asset rows survived a purge; purge must be permanent", count)
	}

	// The delta feed has to carry the removal or a synced client keeps showing
	// photos that no longer exist. change_log holds owner_id for exactly this
	// case: there is no assets row left to join against.
	if grew := countDeleteChanges(t, database) - changesBefore; grew != 2 {
		t.Fatalf("the purge added %d delete rows to change_log, want 2", grew)
	}
}

func countDeleteChanges(t *testing.T, database *sql.DB) int {
	t.Helper()
	var n int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM change_log WHERE entity='asset' AND op='delete' AND entity_id IN ('p1','p2')`).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestBatchPurgeRefusesAssetsNotInTrash proves purge cannot be used as a
// shortcut around the trash: a live asset must be deleted first.
func TestBatchPurgeRefusesAssetsNotInTrash(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	seedOwnedAsset(t, database, "live1")

	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "purge", IDs: []string{"live1"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.BatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Succeeded != 0 || len(resp.Failed) != 1 {
		t.Fatalf("purging a live asset reported succeeded=%d failed=%v; it must fail", resp.Succeeded, resp.Failed)
	}

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM assets WHERE id='live1'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("a live asset was purged without ever being trashed")
	}
}

// TestPatchAssetRating proves a rating can finally be written. It was filterable
// and returned on every asset from the start, but only the importer and the
// Immich migration ever set the column — there was no HTTP write path at all.
func TestPatchAssetRating(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	seedOwnedAsset(t, database, "r1")

	four := 4
	rec := patchJSON(t, router, "/api/assets/r1", apitypes.AssetPatch{Rating: &four}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var got apitypes.Asset
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Rating != 4 {
		t.Fatalf("rating = %d, want 4", got.Rating)
	}

	// 0 clears it. The UI depends on this: clicking the star you are already on
	// is the only way to un-rate something.
	zero := 0
	rec = patchJSON(t, router, "/api/assets/r1", apitypes.AssetPatch{Rating: &zero}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear status = %d body=%s", rec.Code, rec.Body.String())
	}
	var rating int
	if err := database.QueryRow(`SELECT rating FROM assets WHERE id='r1'`).Scan(&rating); err != nil {
		t.Fatal(err)
	}
	if rating != 0 {
		t.Fatalf("rating = %d after clearing, want 0", rating)
	}

	// Out of range is rejected rather than clamped: a 9-star photo would be
	// invisible to every "n and up" filter, which is worse than an error.
	nine := 9
	rec = patchJSON(t, router, "/api/assets/r1", apitypes.AssetPatch{Rating: &nine}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range rating status = %d, want 400", rec.Code)
	}
}

// TestPatchAssetRatingLeavesOtherFieldsAlone proves the patch stays sparse: the
// rating is written by its own statement, so setting it must not blank a caption
// or a capture date the caller never mentioned.
func TestPatchAssetRatingLeavesOtherFieldsAlone(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	seedOwnedAsset(t, database, "r2")
	if _, err := database.Exec(
		`UPDATE assets SET description='a caption', taken_at='2024-03-14T12:00:00Z' WHERE id='r2'`); err != nil {
		t.Fatal(err)
	}

	three := 3
	rec := patchJSON(t, router, "/api/assets/r2", apitypes.AssetPatch{Rating: &three}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	var description, takenAt string
	if err := database.QueryRow(
		`SELECT description, taken_at FROM assets WHERE id='r2'`).Scan(&description, &takenAt); err != nil {
		t.Fatal(err)
	}
	if description != "a caption" {
		t.Fatalf("description = %q after a rating-only patch; it must be untouched", description)
	}
	if takenAt != "2024-03-14T12:00:00Z" {
		t.Fatalf("taken_at = %q after a rating-only patch; it must be untouched", takenAt)
	}
}

// TestDeleteExternalLibrary proves an external library can be removed. There was
// no DELETE route at all, so a mistyped root path was permanent from the UI.
func TestDeleteExternalLibrary(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)

	var owner string
	if err := database.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(
		`INSERT INTO external_libraries(id,owner_id,name,root_path) VALUES('lib1',?,'Photos','/mnt/photos')`,
		owner); err != nil {
		t.Fatal(err)
	}
	seedOwnedAsset(t, database, "e1")
	seedOwnedAsset(t, database, "e2")
	if _, err := database.Exec(`UPDATE assets SET external_library_id='lib1' WHERE id IN ('e1','e2')`); err != nil {
		t.Fatal(err)
	}
	// An ordinary imported asset, to prove the delete is scoped to the library.
	seedOwnedAsset(t, database, "mine")

	req := httptest.NewRequest(http.MethodDelete, "/api/external-libraries/lib1", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	var libs int
	if err := database.QueryRow(`SELECT COUNT(*) FROM external_libraries WHERE id='lib1'`).Scan(&libs); err != nil {
		t.Fatal(err)
	}
	if libs != 0 {
		t.Fatal("the external library row survived its own delete")
	}

	// The indexed rows go with it. external_library_id is ON DELETE SET NULL, so
	// leaving them behind would turn them into orphans indistinguishable from
	// ordinary imported assets pointing at files under an untracked root.
	var orphans int
	if err := database.QueryRow(`SELECT COUNT(*) FROM assets WHERE id IN ('e1','e2')`).Scan(&orphans); err != nil {
		t.Fatal(err)
	}
	if orphans != 0 {
		t.Fatalf("%d indexed assets outlived their external library", orphans)
	}

	var mine int
	if err := database.QueryRow(`SELECT COUNT(*) FROM assets WHERE id='mine'`).Scan(&mine); err != nil {
		t.Fatal(err)
	}
	if mine != 1 {
		t.Fatal("removing an external library deleted an ordinary imported asset")
	}
}

// TestDeleteExternalLibraryIsOwnerScoped proves one owner cannot remove
// another's library, matching every other asset-touching route.
func TestDeleteExternalLibraryIsOwnerScoped(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	// A real second user row: owner_id is a foreign key, so a made-up owner is
	// rejected by the schema before the handler ever sees the request.
	if _, err := database.Exec(
		`INSERT INTO users(id,username,password_hash) VALUES('other-owner','someone-else','x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(
		`INSERT INTO external_libraries(id,owner_id,name,root_path) VALUES('other','other-owner','Theirs','/mnt/theirs')`); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/external-libraries/other", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for another owner's library", rec.Code)
	}

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM external_libraries WHERE id='other'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("another owner's external library was removed")
	}
}
