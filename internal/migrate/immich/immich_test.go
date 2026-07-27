package immich

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/migrate"
)

func TestNewClientNormalizesURL(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"https://photos.example", "https://photos.example/api"},
		{"https://photos.example/", "https://photos.example/api"},
		{"https://photos.example/api", "https://photos.example/api"},
		{"https://photos.example/api/", "https://photos.example/api"},
		{"photos.example", "https://photos.example/api"},
		{"http://10.0.0.5:2283", "http://10.0.0.5:2283/api"},
	} {
		c, err := NewClient(tc.in, "key", nil)
		if err != nil {
			t.Fatalf("NewClient(%q): %v", tc.in, err)
		}
		if c.BaseURL != tc.want {
			t.Errorf("NewClient(%q).BaseURL = %q, want %q", tc.in, c.BaseURL, tc.want)
		}
	}
}

func TestNewClientRejectsMissingInputs(t *testing.T) {
	if _, err := NewClient("", "key", nil); err == nil {
		t.Error("empty url accepted")
	}
	if _, err := NewClient("https://host", "  ", nil); err == nil {
		t.Error("empty api key accepted")
	}
}

func TestClientSendsAPIKeyHeader(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		json.NewEncoder(w).Encode(map[string]int{"major": 1, "minor": 140, "patch": 0})
	}))
	defer srv.Close()

	c := testClient(t, srv.URL)
	version, err := c.Version(context.Background())
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if gotKey != "test-key" {
		t.Errorf("x-api-key = %q, want test-key", gotKey)
	}
	if version != "1.140.0" {
		t.Errorf("version = %q, want 1.140.0", version)
	}
}

func TestClientAuthErrorIsNotRetried(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"message":"Invalid API key"}`)
	}))
	defer srv.Close()

	c := testClient(t, srv.URL)
	_, err := c.Version(context.Background())
	if err == nil {
		t.Fatal("expected an auth error")
	}
	var authErr *AuthError
	if !asAuthError(err, &authErr) {
		t.Fatalf("error = %T (%v), want *AuthError", err, err)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("auth failure was attempted %d times, want 1", got)
	}
	if !strings.Contains(err.Error(), "API key") {
		t.Errorf("error message unhelpful: %v", err)
	}
}

func TestClientRetriesTransientFailures(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		json.NewEncoder(w).Encode(map[string]int{"major": 1, "minor": 0, "patch": 0})
	}))
	defer srv.Close()

	c := testClient(t, srv.URL)
	if _, err := c.Version(context.Background()); err != nil {
		t.Fatalf("version after retries: %v", err)
	}
	if got := calls.Load(); got != 3 {
		t.Errorf("made %d calls, want 3 (two 429s then success)", got)
	}
}

func TestClientGivesUpAfterMaxRetries(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	c := testClient(t, srv.URL)
	c.MaxRetries = 2
	if _, err := c.Version(context.Background()); err == nil {
		t.Fatal("expected failure after retries are exhausted")
	}
	if got := calls.Load(); got != 3 {
		t.Errorf("made %d calls, want 3 (initial + 2 retries)", got)
	}
}

func TestSourceMapsAssetFields(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/server/version":
			json.NewEncoder(w).Encode(map[string]int{"major": 1, "minor": 140, "patch": 0})
		case "/api/server/statistics":
			json.NewEncoder(w).Encode(map[string]int{"photos": 2, "videos": 1})
		case "/api/albums":
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "alb1", "albumName": "Japan", "description": "spring", "assetCount": 1},
			})
		case "/api/tags":
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "tag1", "name": "Kyoto", "value": "Travel/Kyoto", "parentId": "tag0"},
				{"id": "tag0", "name": "Travel", "value": "Travel"},
			})
		case "/api/stacks":
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "st1", "primaryAssetId": "a1",
					"assets": []map[string]any{{"id": "a1"}, {"id": "a9"}}},
			})
		case "/api/search/metadata":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			// Every search must ask for stacked assets; without it Immich omits
			// every member of a stack, primary included.
			if body["withStacked"] != true {
				http.Error(w, "search without withStacked would drop stacked assets", http.StatusTeapot)
				return
			}
			// Album and tag membership are inverted through filtered searches.
			if ids, ok := body["albumIds"].([]any); ok && len(ids) > 0 {
				writeSearch(w, []map[string]any{{"id": "a1"}}, nil)
				return
			}
			if ids, ok := body["tagIds"].([]any); ok && len(ids) > 0 {
				if ids[0] == "tag1" {
					writeSearch(w, []map[string]any{{"id": "a1"}}, nil)
				} else {
					writeSearch(w, nil, nil)
				}
				return
			}
			writeSearch(w, []map[string]any{
				{
					"id": "a1", "type": "IMAGE", "originalFileName": "one.jpg",
					"localDateTime": "2022-06-01T12:00:00.000Z",
					"fileCreatedAt": "2022-06-01T03:00:00.000Z",
					"isFavorite":    true, "visibility": "archive", "duration": "0:00:00.00000",
					"exifInfo": map[string]any{
						"make": "Canon", "model": "R6", "description": "tokyo",
						"latitude": 35.6762, "longitude": 139.6503, "rating": 4,
						"dateTimeOriginal": "2022-06-01T03:00:00.000Z",
					},
					// Deliberately absent: search results do not hydrate tags or
					// stack, so the mapping must come from the prefetched indexes.
				},
				{
					"id": "a2", "type": "IMAGE", "originalFileName": "locked.jpg",
					"visibility": "locked", "localDateTime": "2022-06-02T12:00:00.000Z",
				},
				{
					"id": "a3", "type": "AUDIO", "originalFileName": "note.m4a",
					"visibility": "timeline", "localDateTime": "2022-06-03T12:00:00.000Z",
				},
			}, nil)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	src := testSource(t, srv.URL, Options{IncludeAlbums: true, IncludeTags: true, IncludeStacks: true})
	ctx := context.Background()

	info, err := src.Probe(ctx)
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if info.Version != "1.140.0" || info.TotalAssets != 3 {
		t.Errorf("info = %+v, want 1.140.0 / 3 assets", info)
	}

	albums, err := src.Albums(ctx)
	if err != nil {
		t.Fatalf("albums: %v", err)
	}
	if len(albums) != 1 || albums[0].Name != "Japan" || albums[0].Description != "spring" {
		t.Fatalf("albums = %+v", albums)
	}

	tags, err := src.Tags(ctx)
	if err != nil {
		t.Fatalf("tags: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("tags = %+v", tags)
	}
	var kyoto migrateTag
	for _, tg := range tags {
		if tg.SourceID == "tag1" {
			kyoto = migrateTag{tg.Name, tg.ParentSourceID}
		}
	}
	if kyoto.name != "Kyoto" || kyoto.parent != "tag0" {
		t.Errorf("Kyoto tag = %+v, want leaf name with parent tag0", kyoto)
	}

	page, err := src.Assets(ctx, "")
	if err != nil {
		t.Fatalf("assets: %v", err)
	}
	if len(page.Items) != 3 {
		t.Fatalf("got %d items, want 3", len(page.Items))
	}

	first := page.Items[0]
	if first.Filename != "one.jpg" || first.Skip {
		t.Fatalf("first item = %+v", first)
	}
	if !first.Meta.Favorite || !first.Meta.Archived || first.Meta.Hidden {
		t.Errorf("flags = fav %v archived %v hidden %v", first.Meta.Favorite, first.Meta.Archived, first.Meta.Hidden)
	}
	if first.Meta.Rating != 4 || first.Meta.Description != "tokyo" {
		t.Errorf("rating/description = %d/%q", first.Meta.Rating, first.Meta.Description)
	}
	if first.Meta.CameraMake != "Canon" || first.Meta.CameraModel != "R6" {
		t.Errorf("camera = %q/%q", first.Meta.CameraMake, first.Meta.CameraModel)
	}
	if first.Meta.Lat == nil || *first.Meta.Lat != 35.6762 {
		t.Errorf("latitude = %v", first.Meta.Lat)
	}
	// localDateTime wins over dateTimeOriginal: it is the wall-clock capture time.
	if first.Meta.TakenAt == nil || first.Meta.TakenAt.Hour() != 12 {
		t.Errorf("takenAt = %v, want the 12:00 local time", first.Meta.TakenAt)
	}
	if len(first.AlbumIDs) != 1 || first.AlbumIDs[0] != "alb1" {
		t.Errorf("albumIDs = %v, want [alb1]", first.AlbumIDs)
	}
	if len(first.TagIDs) != 1 || first.TagIDs[0] != "tag1" {
		t.Errorf("tagIDs = %v, want [tag1] from the tag index", first.TagIDs)
	}
	if first.StackID != "stack:st1" || !first.StackPrimary {
		t.Errorf("stack = %q/%v, want stack:st1 as primary from the stack index",
			first.StackID, first.StackPrimary)
	}

	if !page.Items[1].Skip || !strings.Contains(page.Items[1].SkipReason, "locked") {
		t.Errorf("locked asset = %+v, want skipped with a reason", page.Items[1])
	}
	if !page.Items[2].Skip || !strings.Contains(page.Items[2].SkipReason, "AUDIO") {
		t.Errorf("audio asset = %+v, want skipped with a reason", page.Items[2])
	}
}

type migrateTag struct{ name, parent string }

func TestSourceDownloadsOriginal(t *testing.T) {
	want := []byte("original-bytes")
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write(want)
	}))
	defer srv.Close()

	src := testSource(t, srv.URL, Options{})
	var buf bytes.Buffer
	if err := src.Fetch(context.Background(), migrate.Item{SourceID: "a1"}, &buf); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if !bytes.Equal(buf.Bytes(), want) {
		t.Errorf("downloaded %q, want %q", buf.Bytes(), want)
	}
	// The unedited original is what Kuraki stores; no ?edited=true.
	if gotPath != "/api/assets/a1/original" {
		t.Errorf("download path = %q", gotPath)
	}
}

func TestStackForPrefersExplicitStackAndPairsLivePhotos(t *testing.T) {
	s := &Source{
		opts: Options{IncludeStacks: true},
		stacksByAsset: map[string]stackMembership{
			"x": {StackID: "s1", Primary: true},
		},
	}
	if id, primary := s.stackFor(assetDTO{ID: "x", Type: "IMAGE"}); id != "stack:s1" || !primary {
		t.Errorf("explicit stack = %q/%v, want stack:s1/true", id, primary)
	}

	// Both halves of a live photo derive the same key from their own payload,
	// so page ordering cannot separate them.
	stillID, stillPrimary := s.stackFor(assetDTO{ID: "still", Type: "IMAGE", LivePhotoVideoID: "vid"})
	videoID, videoPrimary := s.stackFor(assetDTO{ID: "vid", Type: "VIDEO"})
	if stillID != videoID {
		t.Errorf("live photo halves got different stacks: %q vs %q", stillID, videoID)
	}
	if !stillPrimary || videoPrimary {
		t.Errorf("primary flags = still %v / video %v, want true/false", stillPrimary, videoPrimary)
	}
}

// Regression: a search without withStacked makes Immich omit every member of a
// stack, primary included, so those assets never reach the migration at all.
func TestEverySearchRequestsStackedAssets(t *testing.T) {
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/albums":
			json.NewEncoder(w).Encode([]map[string]any{{"id": "alb1", "albumName": "A"}})
		case "/api/tags":
			json.NewEncoder(w).Encode([]map[string]any{{"id": "tag1", "name": "T", "value": "T"}})
		case "/api/stacks":
			json.NewEncoder(w).Encode([]map[string]any{})
		case "/api/search/metadata":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			bodies = append(bodies, body)
			writeSearch(w, nil, nil)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	src := testSource(t, srv.URL, Options{IncludeAlbums: true, IncludeTags: true, IncludeStacks: true})
	ctx := context.Background()
	if _, err := src.Albums(ctx); err != nil {
		t.Fatalf("albums: %v", err)
	}
	if _, err := src.Tags(ctx); err != nil {
		t.Fatalf("tags: %v", err)
	}
	if _, err := src.Assets(ctx, ""); err != nil {
		t.Fatalf("assets: %v", err)
	}

	if len(bodies) < 3 {
		t.Fatalf("made %d searches, want at least 3 (album, tag, asset walk)", len(bodies))
	}
	for i, b := range bodies {
		if b["withStacked"] != true {
			t.Errorf("search %d sent withStacked=%v, want true", i, b["withStacked"])
		}
	}
}

func TestParseDuration(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want int64
	}{
		{"", 0},
		{"0:00:05.500000", 5500},
		{"0:01:00.000000", 60000},
		{"1:00:00.000000", 3600000},
		{"garbage", 0},
		{"0:00", 0},
	} {
		if got := ParseDuration(tc.in); got != tc.want {
			t.Errorf("ParseDuration(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// --- helpers ---

func testClient(t *testing.T, baseURL string) *Client {
	t.Helper()
	c, err := NewClient(baseURL, "test-key", srvClient())
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	c.RetryBase = time.Millisecond
	return c
}

func testSource(t *testing.T, baseURL string, opts Options) *Source {
	t.Helper()
	src, err := New(baseURL, "test-key", srvClient(), opts)
	if err != nil {
		t.Fatalf("New source: %v", err)
	}
	src.client.RetryBase = time.Millisecond
	return src
}

func srvClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}

func writeSearch(w http.ResponseWriter, items []map[string]any, nextPage *string) {
	resp := map[string]any{
		"albums": map[string]any{"count": 0, "items": []any{}, "facets": []any{}, "total": 0},
		"assets": map[string]any{
			"count": len(items), "items": items, "facets": []any{},
			"total": len(items), "nextPage": nextPage,
		},
	}
	json.NewEncoder(w).Encode(resp)
}

func asAuthError(err error, target **AuthError) bool {
	if e, ok := err.(*AuthError); ok {
		*target = e
		return true
	}
	return false
}
