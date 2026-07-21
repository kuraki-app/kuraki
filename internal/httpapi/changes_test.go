package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// countChanges returns the number of change_log rows for an asset+op.
func countChanges(t *testing.T, db *sql.DB, assetID, op string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM change_log WHERE entity='asset' AND entity_id=? AND op=?`,
		assetID, op).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestFavoriteEmitsChange(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")

	if rec := postFavorite(t, router, token, "a1", true); rec.Code != http.StatusOK {
		t.Fatalf("favorite = %d", rec.Code)
	}
	if n := countChanges(t, db, "a1", "update"); n != 1 {
		t.Fatalf("expected 1 update change for a1, got %d", n)
	}
	// The change carries the owner.
	var owner string
	if err := db.QueryRow(`SELECT owner_id FROM change_log WHERE entity_id='a1' ORDER BY id DESC LIMIT 1`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner == "" {
		t.Fatal("change_log row has empty owner_id")
	}
}

// TestChangesFeedSessionAuth proves the session/cookie mount (/api/changes)
// returns owner-scoped data, mirroring TestChangesFeedCursorAndScope which
// only exercises the device/bearer mount (/api/capture/changes) even though
// both routes share the same d.changes handler.
func TestChangesFeedSessionAuth(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")

	rec := postJSON(t, router, "/api/assets/a1/favorite", apitypes.FavoriteRequest{Favorite: true}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("favorite via session = %d body=%s", rec.Code, rec.Body.String())
	}

	page := getJSONWithCookie[apitypes.ChangesResponse](t, router, "/api/changes?since=0", cookie)
	if len(page.Changes) != 1 {
		t.Fatalf("expected 1 change via session mount, got %+v", page)
	}
	if page.Changes[0].EntityID != "a1" || page.Changes[0].Op != "update" {
		t.Fatalf("unexpected change: %+v", page.Changes[0])
	}
}

// TestBatchFavoriteEmitsChange proves the multi-select batch path (favorite is
// its only single-asset counterpart; archive/hide have none at all) logs an
// 'update' change per asset, via the session-auth /api/assets/batch route.
func TestBatchFavoriteEmitsChange(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")
	seedOwnedAsset(t, db, "a2")

	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "favorite", IDs: []string{"a1", "a2"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch favorite = %d body=%s", rec.Code, rec.Body.String())
	}
	for _, id := range []string{"a1", "a2"} {
		if n := countChanges(t, db, id, "update"); n != 1 {
			t.Fatalf("expected 1 update change for %s, got %d", id, n)
		}
	}
	var owner string
	if err := db.QueryRow(`SELECT owner_id FROM change_log WHERE entity_id='a1' ORDER BY id DESC LIMIT 1`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner == "" {
		t.Fatal("change_log row has empty owner_id")
	}
}

// TestBatchDeleteNotDoubleLogged proves batch delete produces exactly one
// change row — trash.Delete already logs it, so batchAssets must not log again.
func TestBatchDeleteNotDoubleLogged(t *testing.T) {
	router, cookie, db, store := deviceTrashTestRouter(t)
	seedOwnedAssetFile(t, context.Background(), db, store, "a1")

	rec := postJSON(t, router, "/api/assets/batch", apitypes.BatchRequest{Op: "delete", IDs: []string{"a1"}}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch delete = %d body=%s", rec.Code, rec.Body.String())
	}
	if n := countChanges(t, db, "a1", "delete"); n != 1 {
		t.Fatalf("expected exactly 1 delete change for a1, got %d", n)
	}
}

// TestShiftTimeEmitsChange proves the batch capture-time shift logs an
// 'update' change per shifted asset.
func TestShiftTimeEmitsChange(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")
	if _, err := db.Exec(`UPDATE assets SET taken_at = '2026-01-01T12:00:00Z' WHERE id = 'a1'`); err != nil {
		t.Fatal(err)
	}

	rec := postJSON(t, router, "/api/assets/shift-time", apitypes.ShiftRequest{IDs: []string{"a1"}, Minutes: 60}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("shift-time = %d body=%s", rec.Code, rec.Body.String())
	}
	if n := countChanges(t, db, "a1", "update"); n != 1 {
		t.Fatalf("expected 1 update change for a1, got %d", n)
	}
}

func TestChangesFeedCursorAndScope(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")
	seedOwnedAsset(t, db, "a2")

	// Two owned changes.
	postFavorite(t, router, token, "a1", true)
	postFavorite(t, router, token, "a2", true)

	// A second owner's change must be invisible.
	if _, err := db.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('other','other','x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset','z','update','other')`); err != nil {
		t.Fatal(err)
	}

	// Page 1: since=0, limit=1 -> first change, has_more true.
	rec := deviceGet(t, router, token, "/api/capture/changes?since=0&limit=1")
	if rec.Code != http.StatusOK {
		t.Fatalf("changes = %d body=%s", rec.Code, rec.Body.String())
	}
	var page struct {
		Cursor  int64 `json:"cursor"`
		HasMore bool  `json:"has_more"`
		Changes []struct {
			ID       int64  `json:"id"`
			EntityID string `json:"entity_id"`
			Op       string `json:"op"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Changes) != 1 || !page.HasMore {
		t.Fatalf("page1 = %+v", page)
	}
	if page.Changes[0].EntityID != "a1" {
		t.Fatalf("first change should be a1, got %s", page.Changes[0].EntityID)
	}

	// Page 2 from the cursor: the rest, no foreign 'z'.
	rec2 := deviceGet(t, router, token, "/api/capture/changes?since="+strconv.FormatInt(page.Cursor, 10)+"&limit=100")
	var page2 struct {
		Changes []struct {
			EntityID string `json:"entity_id"`
		} `json:"changes"`
		HasMore bool `json:"has_more"`
	}
	json.Unmarshal(rec2.Body.Bytes(), &page2)
	ids := map[string]bool{}
	for _, c := range page2.Changes {
		ids[c.EntityID] = true
	}
	if !ids["a2"] || ids["z"] || page2.HasMore {
		t.Fatalf("page2 leaked or wrong: %+v", page2)
	}
}
