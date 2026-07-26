package migrate

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/domain"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/stacks"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// fakeSource is an in-memory library. Each item's bytes are a distinct JPEG so
// content hashes differ and the importer's dedup does not collapse them.
type fakeSource struct {
	items    []Item
	albums   []Album
	tags     []Tag
	bytesFor map[string][]byte

	pageSize  int
	failFetch map[string]bool

	// Fetch is called concurrently by the engine, as the Source contract
	// allows, so the counter must be atomic.
	fetchCalls atomic.Int32
}

func (f *fakeSource) Name() string { return "fake" }

func (f *fakeSource) Probe(context.Context) (Info, error) {
	return Info{Version: "1.2.3", TotalAssets: len(f.items), Endpoint: "https://fake/api"}, nil
}

func (f *fakeSource) Albums(context.Context) ([]Album, error) { return f.albums, nil }
func (f *fakeSource) Tags(context.Context) ([]Tag, error)     { return f.tags, nil }
func (f *fakeSource) Close() error                            { return nil }

func (f *fakeSource) Assets(_ context.Context, cursor string) (Page, error) {
	size := f.pageSize
	if size <= 0 {
		size = len(f.items)
	}
	start := 0
	if cursor != "" {
		if _, err := fmt.Sscanf(cursor, "%d", &start); err != nil {
			return Page{}, err
		}
	}
	if start >= len(f.items) {
		return Page{}, nil
	}
	end := min(start+size, len(f.items))
	next := ""
	if end < len(f.items) {
		next = fmt.Sprintf("%d", end)
	}
	return Page{Items: f.items[start:end], NextCursor: next}, nil
}

func (f *fakeSource) Fetch(_ context.Context, item Item, dst io.Writer) error {
	f.fetchCalls.Add(1)
	if f.failFetch[item.SourceID] {
		return fmt.Errorf("simulated download failure")
	}
	raw, ok := f.bytesFor[item.SourceID]
	if !ok {
		return fmt.Errorf("no bytes for %s", item.SourceID)
	}
	_, err := dst.Write(raw)
	return err
}

func TestEngineMigratesAssetsAlbumsTagsStacksAndTrash(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)

	taken := time.Date(2022, 6, 1, 12, 0, 0, 0, time.UTC)
	lat, lon := 35.6762, 139.6503
	src := newFakeSource(t,
		Item{
			SourceID: "a1", Filename: "one.jpg",
			Meta: domain.ExternalMetadata{
				TakenAt: &taken, Lat: &lat, Lon: &lon, Description: "tokyo",
				Favorite: true, Rating: 5, Archived: true,
			},
			AlbumIDs: []string{"alb1"},
			TagIDs:   []string{"t-child"},
		},
		Item{SourceID: "a2", Filename: "two.jpg", AlbumIDs: []string{"alb1"}},
		Item{SourceID: "a3", Filename: "three.jpg", Trashed: true},
		Item{SourceID: "s1", Filename: "raw.jpg", StackID: "stack:9", StackPrimary: true},
		Item{SourceID: "s2", Filename: "jpeg.jpg", StackID: "stack:9"},
		Item{SourceID: "x1", Filename: "audio.m4a", Skip: true, SkipReason: "unsupported type"},
	)
	src.albums = []Album{{SourceID: "alb1", Name: "Japan", Description: "spring trip"}}
	src.tags = []Tag{
		{SourceID: "t-child", Name: "Kyoto", ParentSourceID: "t-root"},
		{SourceID: "t-root", Name: "Travel"},
	}

	run, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if run.Status != RunSucceeded {
		t.Fatalf("status = %q, want succeeded", run.Status)
	}
	if run.Imported != 5 || run.Skipped != 1 || run.Errors != 0 {
		t.Fatalf("run = %+v, want 5 imported / 1 skipped / 0 errors", run)
	}

	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 5)

	// Core metadata survived.
	var (
		description, takenAt                string
		gotLat, gotLon                      float64
		favorite, rating, archived, deleted int
	)
	err = database.QueryRowContext(ctx, `
		SELECT COALESCE(description,''), taken_at, gps_lat, gps_lon, favorite, rating, archived,
		       (deleted_at IS NOT NULL)
		FROM assets WHERE filename = 'one.jpg'`).
		Scan(&description, &takenAt, &gotLat, &gotLon, &favorite, &rating, &archived, &deleted)
	if err != nil {
		t.Fatalf("asset one.jpg: %v", err)
	}
	if description != "tokyo" || favorite != 1 || rating != 5 || archived != 1 {
		t.Errorf("one.jpg = desc %q fav %d rating %d archived %d", description, favorite, rating, archived)
	}
	if gotLat != lat || gotLon != lon {
		t.Errorf("gps = %v,%v want %v,%v", gotLat, gotLon, lat, lon)
	}

	// Places came from Kuraki's own geocoder, not from the source.
	var placeCity sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT place_city FROM assets WHERE filename = 'one.jpg'`).Scan(&placeCity); err != nil {
		t.Fatalf("place: %v", err)
	}
	if !placeCity.Valid || placeCity.String == "" {
		t.Error("place_city was not resolved from the migrated coordinates")
	}

	// Album with description, and both members linked.
	var albumName, albumDesc string
	if err := database.QueryRowContext(ctx,
		`SELECT name, description FROM albums`).Scan(&albumName, &albumDesc); err != nil {
		t.Fatalf("album: %v", err)
	}
	if albumName != "Japan" || albumDesc != "spring trip" {
		t.Errorf("album = %q/%q, want Japan/spring trip", albumName, albumDesc)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM album_assets", 2)

	// Tag hierarchy preserved.
	var childParent sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT parent_id FROM tags WHERE name = 'Kyoto'`).Scan(&childParent); err != nil {
		t.Fatalf("tag: %v", err)
	}
	if !childParent.Valid {
		t.Error("Kyoto tag has no parent; hierarchy was lost")
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM asset_tags", 1)

	// Trashed asset landed in the trash, not the timeline.
	assertCount(t, ctx, database,
		`SELECT COUNT(*) FROM assets WHERE filename = 'three.jpg' AND deleted_at IS NOT NULL`, 1)

	// The stack resolved to the convention: both members share the primary's id.
	var stackID string
	var stackPrimary int
	if err := database.QueryRowContext(ctx,
		`SELECT stack_id, stack_primary FROM assets WHERE filename = 'raw.jpg'`).
		Scan(&stackID, &stackPrimary); err != nil {
		t.Fatalf("stack: %v", err)
	}
	if stackPrimary != 1 {
		t.Error("declared primary did not stay primary")
	}
	assertCount(t, ctx, database,
		`SELECT COUNT(*) FROM assets WHERE stack_id = '`+stackID+`'`, 2)
	assertCount(t, ctx, database,
		`SELECT COUNT(*) FROM assets WHERE stack_id LIKE 'migrate:%'`, 0)

	// The skipped item is recorded with its reason rather than silently dropped.
	var skipReason string
	if err := database.QueryRowContext(ctx,
		`SELECT error FROM migration_map WHERE source_id = 'x1'`).Scan(&skipReason); err != nil {
		t.Fatalf("skip mapping: %v", err)
	}
	if skipReason != "unsupported type" {
		t.Errorf("skip reason = %q", skipReason)
	}
}

// A second run against the same source must be a no-op, not a second library.
func TestEngineRerunIsIdempotent(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)
	src := newFakeSource(t,
		Item{SourceID: "a1", Filename: "one.jpg", AlbumIDs: []string{"alb1"}},
		Item{SourceID: "a2", Filename: "two.jpg"},
	)
	src.albums = []Album{{SourceID: "alb1", Name: "Trip"}}

	if _, err := engine.Run(ctx, src); err != nil {
		t.Fatalf("first run: %v", err)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 2)
	firstFetches := src.fetchCalls.Load()

	second, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if second.Imported != 0 {
		t.Errorf("second run imported %d, want 0", second.Imported)
	}
	if src.fetchCalls.Load() != firstFetches {
		t.Errorf("second run downloaded %d more originals, want 0",
			src.fetchCalls.Load()-firstFetches)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 2)
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM albums", 1)
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM album_assets", 1)
}

// A download failure must isolate to its own item and be retried next run.
func TestEngineIsolatesDownloadFailuresAndRetriesThem(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)
	src := newFakeSource(t,
		Item{SourceID: "ok", Filename: "ok.jpg"},
		Item{SourceID: "bad", Filename: "bad.jpg"},
	)
	src.failFetch = map[string]bool{"bad": true}

	run, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if run.Imported != 1 || run.Errors != 1 {
		t.Fatalf("run = %+v, want 1 imported and 1 error", run)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 1)

	var status, message string
	if err := database.QueryRowContext(ctx,
		`SELECT status, error FROM migration_map WHERE source_id = 'bad'`).
		Scan(&status, &message); err != nil {
		t.Fatalf("failed mapping: %v", err)
	}
	if status != StatusError || message == "" {
		t.Errorf("mapping = %q/%q, want an error with a message", status, message)
	}

	// Healed source: the previously failed item is retried and imported.
	src.failFetch = nil
	again, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if again.Imported != 1 {
		t.Errorf("second run imported %d, want the retried item", again.Imported)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 2)
}

// Paging must not lose items when the page size and batch size differ.
func TestEngineWalksMultiplePages(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)
	engine.Opts.BatchSize = 2

	items := make([]Item, 0, 7)
	for i := range 7 {
		items = append(items, Item{
			SourceID: fmt.Sprintf("a%d", i),
			Filename: fmt.Sprintf("img%d.jpg", i),
		})
	}
	src := newFakeSource(t, items...)
	src.pageSize = 3

	run, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if run.Imported != 7 {
		t.Errorf("imported %d, want 7", run.Imported)
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 7)
}

func TestEngineDryRunWritesNothing(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)
	engine.Opts.DryRun = true
	var out bytes.Buffer
	engine.Opts.Progress = &out

	src := newFakeSource(t,
		Item{SourceID: "a1", Filename: "one.jpg"},
		Item{SourceID: "x1", Filename: "a.m4a", Skip: true, SkipReason: "unsupported"},
	)
	src.albums = []Album{{SourceID: "alb1", Name: "Trip"}}

	run, err := engine.Run(ctx, src)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if run.Imported != 1 || run.Skipped != 1 {
		t.Errorf("dry run = %+v, want 1 would-import and 1 skip", run)
	}
	if src.fetchCalls.Load() != 0 {
		t.Errorf("dry run downloaded %d originals, want 0", src.fetchCalls.Load())
	}
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM assets", 0)
	assertCount(t, ctx, database, "SELECT COUNT(*) FROM albums", 0)
	if out.Len() == 0 {
		t.Error("dry run printed no summary")
	}
}

// stacks.Detect rebuilds stacks from filename heuristics after every import.
// A stack the source stated explicitly must survive that, or the first upload
// after a migration would silently dissolve it.
func TestMigratedStacksSurviveStackDetection(t *testing.T) {
	ctx := context.Background()
	engine, database, _ := newTestEngine(t, ctx)

	// Deliberately unrelated filenames: heuristic detection would never group
	// these, so only the migrated stack can be keeping them together.
	src := newFakeSource(t,
		Item{SourceID: "s1", Filename: "sunrise.jpg", StackID: "stack:1", StackPrimary: true},
		Item{SourceID: "s2", Filename: "totally-different.jpg", StackID: "stack:1"},
	)
	if _, err := engine.Run(ctx, src); err != nil {
		t.Fatalf("run: %v", err)
	}

	var before string
	if err := database.QueryRowContext(ctx,
		`SELECT stack_id FROM assets WHERE filename = 'sunrise.jpg'`).Scan(&before); err != nil {
		t.Fatalf("stack before detect: %v", err)
	}
	assertCount(t, ctx, database,
		`SELECT COUNT(*) FROM assets WHERE stack_id = '`+before+`'`, 2)

	if err := stacks.Detect(ctx, database); err != nil {
		t.Fatalf("detect: %v", err)
	}

	var after sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT stack_id FROM assets WHERE filename = 'sunrise.jpg'`).Scan(&after); err != nil {
		t.Fatalf("stack after detect: %v", err)
	}
	if !after.Valid || after.String != before {
		t.Fatalf("stack after detect = %v, want it preserved as %q", after, before)
	}
	assertCount(t, ctx, database,
		`SELECT COUNT(*) FROM assets WHERE stack_id = '`+before+`'`, 2)
}

func TestOrderTagsParentsFirst(t *testing.T) {
	tags := []Tag{
		{SourceID: "c", Name: "leaf", ParentSourceID: "b"},
		{SourceID: "b", Name: "mid", ParentSourceID: "a"},
		{SourceID: "a", Name: "root"},
		{SourceID: "orphan", Name: "orphan", ParentSourceID: "missing"},
	}
	ordered := orderTagsParentsFirst(tags)
	if len(ordered) != len(tags) {
		t.Fatalf("got %d tags, want %d", len(ordered), len(tags))
	}
	seen := make(map[string]int, len(ordered))
	for i, t := range ordered {
		seen[t.SourceID] = i
	}
	if seen["a"] > seen["b"] || seen["b"] > seen["c"] {
		t.Errorf("parents not ordered first: %v", seen)
	}
}

// A tag cycle must not hang or drop tags.
func TestOrderTagsHandlesCycle(t *testing.T) {
	tags := []Tag{
		{SourceID: "a", Name: "a", ParentSourceID: "b"},
		{SourceID: "b", Name: "b", ParentSourceID: "a"},
	}
	if got := len(orderTagsParentsFirst(tags)); got != 2 {
		t.Fatalf("got %d tags, want 2", got)
	}
}

// --- helpers ---

func newTestEngine(t *testing.T, ctx context.Context) (*Engine, *sql.DB, string) {
	t.Helper()
	dataDir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store, err := storage.NewFS(dataDir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	staging := filepath.Join(dataDir, "staging")
	for _, dir := range []string{"originals", "derivatives", "trash", "staging"} {
		if err := os.MkdirAll(filepath.Join(dataDir, dir), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	return &Engine{
		DB:         database,
		Store:      store,
		Media:      media.NewPureGo(),
		Log:        slog.New(slog.DiscardHandler),
		StagingDir: staging,
	}, database, dataDir
}

// newFakeSource gives every item its own distinct JPEG bytes.
func newFakeSource(t *testing.T, items ...Item) *fakeSource {
	t.Helper()
	src := &fakeSource{items: items, bytesFor: make(map[string][]byte, len(items))}
	for i, item := range items {
		if item.Skip {
			continue
		}
		src.bytesFor[item.SourceID] = jpegBytes(t, 12+i, 8+i)
	}
	return src
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(x * 7), G: uint8(y * 11), B: uint8(w * 3), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

func assertCount(t *testing.T, ctx context.Context, database *sql.DB, query string, want int) {
	t.Helper()
	var got int
	if err := database.QueryRowContext(ctx, query).Scan(&got); err != nil {
		t.Fatalf("count query %q: %v", query, err)
	}
	if got != want {
		t.Fatalf("%q = %d, want %d", query, got, want)
	}
}
