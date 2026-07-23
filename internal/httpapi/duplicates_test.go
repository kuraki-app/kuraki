package httpapi

import (
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// TestDuplicatesExcludesTrashed proves a resolved duplicate (extra copies moved
// to Trash) does not resurface in the duplicate groups, and that a group with
// only one surviving member is dropped entirely.
func TestDuplicatesExcludesTrashed(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")
	seedOwnedAsset(t, db, "a2")
	seedOwnedAsset(t, db, "a3")

	var owner string
	if err := db.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(
		`INSERT INTO duplicate_runs(id,owner_id,status,algorithm_version,total,processed,group_count)
		 VALUES('run1',?,'succeeded',1,3,3,1)`, owner); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a1", "a2", "a3"} {
		if _, err := db.Exec(
			`INSERT INTO duplicate_group_members(run_id,group_id,asset_id) VALUES('run1',1,?)`, id); err != nil {
			t.Fatal(err)
		}
	}

	type dupResp struct {
		Groups [][]apitypes.DupAsset `json:"groups"`
	}

	// Trash one copy: the group keeps its two live members, a1 is gone.
	if _, err := db.Exec(`UPDATE assets SET deleted_at=? WHERE id='a1'`, "2026-07-23T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	got := getJSONWithCookie[dupResp](t, router, "/api/duplicates", cookie)
	if len(got.Groups) != 1 {
		t.Fatalf("want 1 group, got %d", len(got.Groups))
	}
	if len(got.Groups[0]) != 2 {
		t.Fatalf("trashed a1 should be excluded; want 2 live members, got %d", len(got.Groups[0]))
	}
	for _, m := range got.Groups[0] {
		if m.ID == "a1" {
			t.Fatalf("trashed asset a1 still present in the duplicate group")
		}
	}

	// Trash a second copy: only a3 survives, so the group is no longer a
	// duplicate set and must disappear.
	if _, err := db.Exec(`UPDATE assets SET deleted_at=? WHERE id='a2'`, "2026-07-23T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	got2 := getJSONWithCookie[dupResp](t, router, "/api/duplicates", cookie)
	if len(got2.Groups) != 0 {
		t.Fatalf("a group with one live member should be dropped, got %d groups", len(got2.Groups))
	}
}
