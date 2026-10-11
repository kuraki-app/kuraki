package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// These exercise the trip endpoints against rows inserted directly rather than
// against internal/trips' detection. The seeded pagination library holds seven
// undated, GPS-less assets -- below MinAssets and with nothing to cluster on --
// so depending on detection here would test the engine a second time and leave
// the HTTP layer uncovered. internal/trips owns the clustering tests.

func tripOwner(t *testing.T, database *sql.DB) string {
	t.Helper()
	var owner string
	if err := database.QueryRow(`SELECT id FROM users ORDER BY id LIMIT 1`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	return owner
}

// seedTrip inserts a trip owned by owner with the given detected members.
func seedTrip(t *testing.T, database *sql.DB, tripID, owner string, detected []string) {
	t.Helper()
	if _, err := database.Exec(`
		INSERT INTO trips (id, owner_id, started_at, ended_at, place_city, place_country, algorithm_version)
		VALUES (?, ?, '2024-03-01T09:00:00Z', '2024-03-04T18:00:00Z', 'Jaipur', 'India', 1)`,
		tripID, owner); err != nil {
		t.Fatal(err)
	}
	for _, id := range detected {
		if _, err := database.Exec(
			`INSERT INTO trip_members (trip_id, asset_id, source) VALUES (?, ?, 'detected')`,
			tripID, id); err != nil {
			t.Fatal(err)
		}
	}
}

// libraryAssetIDs returns the seeded library's asset ids, newest first.
func libraryAssetIDs(t *testing.T, f paginationFixture) []string {
	t.Helper()
	list := getJSONWithCookie[apitypes.AssetList](t, f.router, "/api/assets", f.cookie)
	ids := make([]string, 0, len(list.Assets))
	for _, a := range list.Assets {
		ids = append(ids, a.ID)
	}
	if len(ids) < 3 {
		t.Fatalf("library seeded %d assets, need at least 3", len(ids))
	}
	return ids
}

func TestTripListCarriesCoverAndCount(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	ids := libraryAssetIDs(t, f)
	seedTrip(t, f.db, "trip-1", tripOwner(t, f.db), ids)

	list := getJSONWithCookie[apitypes.TripList](t, f.router, "/api/trips", f.cookie)
	if len(list.Trips) != 1 {
		t.Fatalf("trips = %d, want 1", len(list.Trips))
	}
	got := list.Trips[0]
	if got.AssetCount != len(ids) {
		t.Errorf("AssetCount = %d, want %d", got.AssetCount, len(ids))
	}
	if got.PlaceCity != "Jaipur" || got.PlaceCountry != "India" {
		t.Errorf("place = %q/%q, want Jaipur/India", got.PlaceCity, got.PlaceCountry)
	}
	if got.NameSource != "auto" || got.Name != "" {
		t.Errorf("name = %q/%q, want empty/auto", got.Name, got.NameSource)
	}
	// Capped at the mosaic size, like an album cover.
	if len(got.CoverAssetIDs) != coverAssetsPerTrip {
		t.Errorf("cover ids = %d, want %d", len(got.CoverAssetIDs), coverAssetsPerTrip)
	}
	seen := map[string]bool{}
	for _, id := range got.CoverAssetIDs {
		if seen[id] {
			t.Errorf("duplicate cover id %s", id)
		}
		seen[id] = true
	}
}

// TestGetTripAppliesTheOverlay is the HTTP-level half of the overlay rule: a
// removed asset must not be served even though its row is still there, and an
// added one must be, even though detection never placed it.
func TestGetTripAppliesTheOverlay(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	ids := libraryAssetIDs(t, f)
	owner := tripOwner(t, f.db)
	// Detection placed the first three only.
	seedTrip(t, f.db, "trip-1", owner, ids[:3])

	if _, err := f.db.Exec(
		`UPDATE trip_members SET source = 'removed' WHERE trip_id = 'trip-1' AND asset_id = ?`, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(
		`INSERT INTO trip_members (trip_id, asset_id, source) VALUES ('trip-1', ?, 'added')`, ids[5]); err != nil {
		t.Fatal(err)
	}

	page := getJSONWithCookie[apitypes.AssetList](t, f.router, "/api/trips/trip-1", f.cookie)
	got := map[string]bool{}
	for _, a := range page.Assets {
		got[a.ID] = true
	}
	if got[ids[0]] {
		t.Error("a removed asset was served as a trip member")
	}
	if !got[ids[1]] || !got[ids[2]] {
		t.Error("detected members missing from the trip")
	}
	if !got[ids[5]] {
		t.Error("a user-added asset was not served as a trip member")
	}
	if len(page.Assets) != 3 {
		t.Errorf("members = %d, want 3", len(page.Assets))
	}
}

// The trip= filter and GET /api/trips/{id} must agree, since the clients use
// whichever is convenient and a divergence would show as photos appearing in
// one view but not the other.
func TestTripFilterAgreesWithGetTrip(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	ids := libraryAssetIDs(t, f)
	seedTrip(t, f.db, "trip-1", tripOwner(t, f.db), ids[:4])
	if _, err := f.db.Exec(
		`UPDATE trip_members SET source = 'removed' WHERE trip_id = 'trip-1' AND asset_id = ?`, ids[0]); err != nil {
		t.Fatal(err)
	}

	direct := getJSONWithCookie[apitypes.AssetList](t, f.router, "/api/trips/trip-1", f.cookie)
	filtered := getJSONWithCookie[apitypes.AssetList](t, f.router, "/api/search?trip=trip-1", f.cookie)
	if len(direct.Assets) != len(filtered.Assets) {
		t.Fatalf("trip endpoint served %d assets, trip= filter served %d",
			len(direct.Assets), len(filtered.Assets))
	}
	for i := range direct.Assets {
		if direct.Assets[i].ID != filtered.Assets[i].ID {
			t.Errorf("order differs at %d: %s vs %s", i, direct.Assets[i].ID, filtered.Assets[i].ID)
		}
	}
}

func TestPatchTripNamesAndReverts(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	seedTrip(t, f.db, "trip-1", tripOwner(t, f.db), libraryAssetIDs(t, f)[:3])

	name := "Rajasthan"
	if rec := patchJSON(t, f.router, "/api/trips/trip-1",
		apitypes.TripRequest{Name: &name}, f.cookie); rec.Code != http.StatusOK {
		t.Fatalf("rename = %d body=%s", rec.Code, rec.Body.String())
	}
	got := getJSONWithCookie[apitypes.TripList](t, f.router, "/api/trips", f.cookie).Trips[0]
	if got.Name != name || got.NameSource != "user" {
		t.Fatalf("after rename: name=%q source=%q", got.Name, got.NameSource)
	}

	// Clearing the name hands the trip back to its automatic label rather than
	// leaving it permanently blank.
	empty := ""
	if rec := patchJSON(t, f.router, "/api/trips/trip-1",
		apitypes.TripRequest{Name: &empty}, f.cookie); rec.Code != http.StatusOK {
		t.Fatalf("clear name = %d", rec.Code)
	}
	got = getJSONWithCookie[apitypes.TripList](t, f.router, "/api/trips", f.cookie).Trips[0]
	if got.Name != "" || got.NameSource != "auto" {
		t.Errorf("after clearing: name=%q source=%q, want empty/auto", got.Name, got.NameSource)
	}
}

// TestRemoveThenAddFlipsTheTombstone covers the one place trips deliberately
// diverge from albums: ON CONFLICT DO UPDATE rather than INSERT OR IGNORE.
// With OR IGNORE the re-add below would silently do nothing.
func TestRemoveThenAddFlipsTheTombstone(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	ids := libraryAssetIDs(t, f)
	seedTrip(t, f.db, "trip-1", tripOwner(t, f.db), ids[:3])

	body := apitypes.AssetIDs{IDs: []string{ids[0]}}
	if rec := methodJSON(t, f.router, http.MethodDelete, "/api/trips/trip-1/assets", body, f.cookie); rec.Code != http.StatusOK {
		t.Fatalf("remove = %d body=%s", rec.Code, rec.Body.String())
	}
	if n := memberCount(t, f.db, "trip-1"); n != 2 {
		t.Fatalf("after remove members = %d, want 2", n)
	}

	if rec := postJSON(t, f.router, "/api/trips/trip-1/assets", body, f.cookie); rec.Code != http.StatusOK {
		t.Fatalf("re-add = %d body=%s", rec.Code, rec.Body.String())
	}
	if n := memberCount(t, f.db, "trip-1"); n != 3 {
		t.Errorf("after re-add members = %d, want 3 -- the tombstone did not flip", n)
	}
	var source string
	if err := f.db.QueryRow(
		`SELECT source FROM trip_members WHERE trip_id = 'trip-1' AND asset_id = ?`, ids[0]).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source != "added" {
		t.Errorf("source = %q, want added", source)
	}
}

func memberCount(t *testing.T, database *sql.DB, tripID string) int {
	t.Helper()
	var n int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM trip_members WHERE trip_id = ? AND source IN ('detected','added')`,
		tripID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Every trip endpoint must refuse another owner's trip. The owner-scope guard
// cannot prove this for the member listing (its WHERE is concatenated with a
// cursor predicate), so it is proven here instead.
func TestTripEndpointsAreOwnerScoped(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	other := secondOwner(t, f.db)
	seedOwnedAssetFor(t, f.db, "other-asset", other)
	seedTrip(t, f.db, "other-trip", other, []string{"other-asset"})

	// The caller's own library also has a trip, so a blanket failure would not
	// pass this test by accident.
	seedTrip(t, f.db, "own-trip", tripOwner(t, f.db), libraryAssetIDs(t, f)[:3])

	list := getJSONWithCookie[apitypes.TripList](t, f.router, "/api/trips", f.cookie)
	for _, tr := range list.Trips {
		if tr.ID == "other-trip" {
			t.Error("another owner's trip appeared in the list")
		}
	}

	if rec := getRawWithCookie(t, f.router, "/api/trips/other-trip", f.cookie); rec.Code != http.StatusNotFound {
		t.Errorf("GET other owner's trip = %d, want 404", rec.Code)
	}
	name := "stolen"
	if rec := patchJSON(t, f.router, "/api/trips/other-trip",
		apitypes.TripRequest{Name: &name}, f.cookie); rec.Code != http.StatusNotFound {
		t.Errorf("PATCH other owner's trip = %d, want 404", rec.Code)
	}
	body := apitypes.AssetIDs{IDs: []string{"other-asset"}}
	if rec := postJSON(t, f.router, "/api/trips/other-trip/assets", body, f.cookie); rec.Code != http.StatusNotFound {
		t.Errorf("POST to other owner's trip = %d, want 404", rec.Code)
	}
	if rec := methodJSON(t, f.router, http.MethodDelete, "/api/trips/other-trip/assets", body, f.cookie); rec.Code != http.StatusNotFound {
		t.Errorf("DELETE from other owner's trip = %d, want 404", rec.Code)
	}

	// And a cross-owner asset cannot be smuggled into a trip the caller does own.
	if rec := postJSON(t, f.router, "/api/trips/own-trip/assets", body, f.cookie); rec.Code != http.StatusOK {
		t.Fatalf("add to own trip = %d", rec.Code)
	}
	var leaked int
	if err := f.db.QueryRow(
		`SELECT COUNT(*) FROM trip_members WHERE trip_id = 'own-trip' AND asset_id = 'other-asset'`).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Error("another owner's asset was linked into the caller's trip")
	}
}
