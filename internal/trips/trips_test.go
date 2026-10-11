package trips

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
)

// newDB opens a migrated throwaway library with one owner.
func newDB(t *testing.T, owners ...string) *sql.DB {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	if len(owners) == 0 {
		owners = []string{"owner"}
	}
	for _, o := range owners {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO users(id,username,password_hash) VALUES(?,?,'hash')`, o, o); err != nil {
			t.Fatal(err)
		}
	}
	return database
}

// seed inserts n assets starting at start, one hour apart, at the given
// coordinates. Filenames and hashes are distinct so nothing is deduplicated.
func seed(t *testing.T, database *sql.DB, owner, prefix string, start time.Time, n int, lat, lon float64, city string) []string {
	t.Helper()
	ctx := context.Background()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("%s-%d", prefix, i)
		taken := start.Add(time.Duration(i) * time.Hour).UTC().Format(time.RFC3339)
		if _, err := database.ExecContext(ctx, `
			INSERT INTO assets(id,owner_id,content_hash,original_path,filename,mime_type,media_type,
			                   taken_at,gps_lat,gps_lon,place_city,place_country)
			VALUES(?,?,?,?,?,'image/jpeg','image',?,?,?,?,?)`,
			id, owner, id, "2026/01/"+id+".jpg", id+".jpg", taken, lat, lon, city, "India"); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func tripRows(t *testing.T, database *sql.DB, owner string) []Trip {
	t.Helper()
	rows, err := database.Query(`
		SELECT id, name, name_source, started_at, ended_at, place_city,
		       (SELECT COUNT(*) FROM trip_members m WHERE m.trip_id = t.id AND m.source IN ('detected','added'))
		FROM trips t WHERE owner_id = ? ORDER BY started_at`, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []Trip
	for rows.Next() {
		var tr Trip
		if err := rows.Scan(&tr.ID, &tr.Name, &tr.NameSource, &tr.StartedAt, &tr.EndedAt, &tr.PlaceCity, &tr.AssetCount); err != nil {
			t.Fatal(err)
		}
		out = append(out, tr)
	}
	return out
}

// Home is Delhi in these fixtures; Jaipur is ~240km away, comfortably outside
// HomeRadiusKM, and a second cluster at the same place tests time splitting.
const (
	homeLat, homeLon   = 28.61, 77.20
	awayLat, awayLon   = 26.91, 75.78
	farLat, farLon     = 15.29, 74.12
	base               = "2024-03-01T09:00:00Z"
	homeCity, awayCity = "Delhi", "Jaipur"
)

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestDetectGroupsAnAwayCluster(t *testing.T) {
	database := newDB(t)
	start := mustTime(t, base)
	// A large block of ordinary life at home establishes the home point.
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "jaipur", start, 12, awayLat, awayLon, awayCity)

	if err := Detect(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	got := tripRows(t, database, "owner")
	if len(got) != 1 {
		t.Fatalf("trips = %d, want 1: %#v", len(got), got)
	}
	if got[0].AssetCount != 12 {
		t.Errorf("AssetCount = %d, want 12", got[0].AssetCount)
	}
	if got[0].PlaceCity != awayCity {
		t.Errorf("PlaceCity = %q, want %q", got[0].PlaceCity, awayCity)
	}
	if got[0].NameSource != "auto" {
		t.Errorf("NameSource = %q, want auto", got[0].NameSource)
	}
}

func TestDetectSplitsOnATimeGap(t *testing.T) {
	database := newDB(t)
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "first", start, 10, awayLat, awayLon, awayCity)
	// Well past GapHours after the first block's last photo.
	seed(t, database, "owner", "second", start.Add(60*time.Hour), 10, awayLat, awayLon, awayCity)

	if err := Detect(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	if got := tripRows(t, database, "owner"); len(got) != 2 {
		t.Fatalf("trips = %d, want 2: %#v", len(got), got)
	}
}

func TestDetectSplitsOnDistanceWithoutAGap(t *testing.T) {
	database := newDB(t)
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "jaipur", start, 10, awayLat, awayLon, awayCity)
	// Continues one hour later but hundreds of km away: a different place, so
	// a different trip even though no time gap separates them.
	seed(t, database, "owner", "goa", start.Add(10*time.Hour), 10, farLat, farLon, "Goa")

	if err := Detect(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	if got := tripRows(t, database, "owner"); len(got) != 2 {
		t.Fatalf("trips = %d, want 2: %#v", len(got), got)
	}
}

func TestDetectIgnoresSmallAndHomeClusters(t *testing.T) {
	database := newDB(t)
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	// Below MinAssets, even though it is far away.
	seed(t, database, "owner", "brief", start, MinAssets-1, awayLat, awayLon, awayCity)
	// Plenty of photos, but at home and inside a single day.
	seed(t, database, "owner", "party", start.Add(200*time.Hour), 20, homeLat, homeLon, homeCity)

	if err := Detect(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	if got := tripRows(t, database, "owner"); len(got) != 0 {
		t.Fatalf("trips = %d, want 0: %#v", len(got), got)
	}
}

func TestDetectExcludesUndatedAssets(t *testing.T) {
	database := newDB(t)
	ctx := context.Background()
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "jaipur", start, 12, awayLat, awayLon, awayCity)
	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("undated-%d", i)
		if _, err := database.ExecContext(ctx, `
			INSERT INTO assets(id,owner_id,content_hash,original_path,filename,mime_type,media_type,gps_lat,gps_lon)
			VALUES(?,?,?,?,?,'image/png','image',?,?)`,
			id, "owner", id, "2026/01/"+id+".png", id+".png", awayLat, awayLon); err != nil {
			t.Fatal(err)
		}
	}
	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	got := tripRows(t, database, "owner")
	if len(got) != 1 || got[0].AssetCount != 12 {
		t.Fatalf("undated assets leaked into trips: %#v", got)
	}
}

// TestRecomputePreservesUserEdits is the overlay rule end to end: it is the
// reason trip_members carries a source column at all.
func TestRecomputePreservesUserEdits(t *testing.T) {
	database := newDB(t)
	ctx := context.Background()
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	ids := seed(t, database, "owner", "jaipur", start, 12, awayLat, awayLon, awayCity)

	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	got := tripRows(t, database, "owner")
	if len(got) != 1 {
		t.Fatalf("setup produced %d trips", len(got))
	}
	tripID := got[0].ID

	// The user renames it, drops one detected photo, and adopts an unrelated
	// one that detection never put here.
	if _, err := database.ExecContext(ctx,
		`UPDATE trips SET name = 'Rajasthan', name_source = 'user' WHERE id = ?`, tripID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`UPDATE trip_members SET source = 'removed' WHERE trip_id = ? AND asset_id = ?`, tripID, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO trip_members(trip_id,asset_id,source) VALUES(?,?,'added')`, tripID, "home-0"); err != nil {
		t.Fatal(err)
	}

	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}

	after := tripRows(t, database, "owner")
	if len(after) != 1 {
		t.Fatalf("recompute changed trip count: %#v", after)
	}
	if after[0].ID != tripID {
		t.Errorf("trip identity moved: %s -> %s", tripID, after[0].ID)
	}
	if after[0].Name != "Rajasthan" || after[0].NameSource != "user" {
		t.Errorf("user name lost: %q / %q", after[0].Name, after[0].NameSource)
	}

	var source string
	if err := database.QueryRow(
		`SELECT source FROM trip_members WHERE trip_id = ? AND asset_id = ?`, tripID, ids[0]).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source != "removed" {
		t.Errorf("removed asset came back as %q -- detection overwrote a user decision", source)
	}
	if err := database.QueryRow(
		`SELECT source FROM trip_members WHERE trip_id = ? AND asset_id = 'home-0'`, tripID).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source != "added" {
		t.Errorf("added asset became %q, want added", source)
	}
	// 12 detected - 1 removed + 1 added
	if after[0].AssetCount != 12 {
		t.Errorf("AssetCount = %d, want 12", after[0].AssetCount)
	}
}

// TestRecomputeAbsorbsLateImports is the case that motivates re-running
// detection at all: a Takeout dump arriving later must join the trip it
// belongs to rather than creating a second one beside it.
func TestRecomputeAbsorbsLateImports(t *testing.T) {
	database := newDB(t)
	ctx := context.Background()
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "jaipur", start, 12, awayLat, awayLon, awayCity)
	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	before := tripRows(t, database, "owner")
	if len(before) != 1 {
		t.Fatalf("setup produced %d trips", len(before))
	}

	// More photos from the middle of the same stretch arrive later.
	seed(t, database, "owner", "late", start.Add(3*time.Hour), 6, awayLat, awayLon, awayCity)
	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	after := tripRows(t, database, "owner")
	if len(after) != 1 {
		t.Fatalf("late import created a second trip: %#v", after)
	}
	if after[0].ID != before[0].ID {
		t.Errorf("trip identity moved on absorb: %s -> %s", before[0].ID, after[0].ID)
	}
	if after[0].AssetCount != 18 {
		t.Errorf("AssetCount = %d, want 18", after[0].AssetCount)
	}
}

func TestDetectIsOwnerScoped(t *testing.T) {
	database := newDB(t, "a", "b")
	ctx := context.Background()
	start := mustTime(t, base)
	seed(t, database, "a", "a-home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "a", "a-away", start, 12, awayLat, awayLon, awayCity)
	seed(t, database, "b", "b-home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "b", "b-away", start, 12, farLat, farLon, "Goa")

	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	for owner, wantCity := range map[string]string{"a": awayCity, "b": "Goa"} {
		got := tripRows(t, database, owner)
		if len(got) != 1 {
			t.Fatalf("owner %s: trips = %d, want 1", owner, len(got))
		}
		if got[0].PlaceCity != wantCity {
			t.Errorf("owner %s: PlaceCity = %q, want %q", owner, got[0].PlaceCity, wantCity)
		}
		var foreign int
		if err := database.QueryRow(`
			SELECT COUNT(*) FROM trip_members m
			JOIN assets a ON a.id = m.asset_id
			WHERE m.trip_id = ? AND a.owner_id <> ?`, got[0].ID, owner).Scan(&foreign); err != nil {
			t.Fatal(err)
		}
		if foreign != 0 {
			t.Errorf("owner %s: trip holds %d assets belonging to another owner", owner, foreign)
		}
	}
}

func TestStaleAutoTripIsRemovedButEditedOneSurvives(t *testing.T) {
	database := newDB(t)
	ctx := context.Background()
	start := mustTime(t, base)
	seed(t, database, "owner", "home", start.AddDate(0, -1, 0), 40, homeLat, homeLon, homeCity)
	seed(t, database, "owner", "jaipur", start, 12, awayLat, awayLon, awayCity)
	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	got := tripRows(t, database, "owner")
	if len(got) != 1 {
		t.Fatalf("setup produced %d trips", len(got))
	}
	autoID := got[0].ID

	// A second trip the user named, covering a stretch that no longer has any
	// assets at all.
	if _, err := database.ExecContext(ctx, `
		INSERT INTO trips(id,owner_id,name,name_source,started_at,ended_at,algorithm_version)
		VALUES('kept','owner','Kept','user','2020-01-01T00:00:00Z','2020-01-05T00:00:00Z',1)`); err != nil {
		t.Fatal(err)
	}
	// And an unnamed one over the same empty stretch, which should not survive.
	if _, err := database.ExecContext(ctx, `
		INSERT INTO trips(id,owner_id,started_at,ended_at,algorithm_version)
		VALUES('stale','owner','2021-01-01T00:00:00Z','2021-01-05T00:00:00Z',1)`); err != nil {
		t.Fatal(err)
	}

	if err := Detect(ctx, database); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, tr := range tripRows(t, database, "owner") {
		ids[tr.ID] = true
	}
	if !ids["kept"] {
		t.Error("a user-named trip was deleted by a recompute")
	}
	if ids["stale"] {
		t.Error("an unclaimed auto trip survived a recompute")
	}
	if !ids[autoID] {
		t.Error("the live detected trip was deleted")
	}
}
