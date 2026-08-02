package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

const paginationSeedCount = 7

// Every asset-listing endpoint computes a next_cursor from the last row of a
// page and sends it. Four of them then dropped it on the floor: the cursor
// never reached the WHERE clause, so following it re-served the first page.
//
// Mobile pages Trash and On-this-day and appends each response to what it
// already has, which turned that into an endless run of duplicate rows on
// scroll; the other surfaces silently stopped at one page. These walk each
// endpoint to exhaustion and assert the pages are disjoint and complete, which
// is the property that was missing rather than any particular page size.
func TestListEndpointsPaginateWithoutRepeatingRows(t *testing.T) {
	for _, tc := range []struct {
		name string
		// path is built after the fixture is prepared, so the album case can
		// use the id it just created.
		prepare func(t *testing.T, ctx context.Context, f paginationFixture) string
	}{
		{
			name: "favorites",
			prepare: func(t *testing.T, ctx context.Context, f paginationFixture) string {
				mustExec(t, ctx, f.db, `UPDATE assets SET favorite = 1`)
				return "/api/favorites"
			},
		},
		{
			name: "trash",
			prepare: func(t *testing.T, ctx context.Context, f paginationFixture) string {
				mustExec(t, ctx, f.db, `UPDATE assets SET deleted_at = datetime('now')`)
				return "/api/trash"
			},
		},
		{
			name: "memories",
			prepare: func(t *testing.T, ctx context.Context, f paginationFixture) string {
				// On-this-day matches on month-day, so the fixture's dates have
				// to land on today with distinct times.
				mustExec(t, ctx, f.db, `
					UPDATE assets
					SET taken_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || (rowid * 60) || ' seconds')`)
				return "/api/memories"
			},
		},
		{
			name: "album",
			prepare: func(t *testing.T, ctx context.Context, f paginationFixture) string {
				return "/api/albums/" + createTestAlbum(t, f)
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			// A library each: trash needs every asset deleted, and the other
			// three need them all live.
			f := seedPaginationLibrary(t, ctx, paginationSeedCount)
			path := tc.prepare(t, ctx, f)

			seen := map[string]bool{}
			cursor := ""
			// Bounded so a cursor that never advances fails here rather than
			// spinning — which is exactly what the old behaviour would do.
			for page := 0; page < 10; page++ {
				url := path + "?limit=2"
				if cursor != "" {
					url += "&cursor=" + cursor
				}
				got := getJSONWithCookie[apitypes.AssetList](t, f.router, url, f.cookie)
				for _, a := range got.Assets {
					if seen[a.ID] {
						t.Fatalf("page %d re-served asset %s; the cursor is not being applied", page, a.ID)
					}
					seen[a.ID] = true
				}
				if got.NextCursor == "" {
					break
				}
				cursor = got.NextCursor
			}
			if len(seen) != paginationSeedCount {
				t.Fatalf("paged %d assets, want all %d — pages are not complete", len(seen), paginationSeedCount)
			}
		})
	}
}

// A malformed cursor must be rejected rather than silently ignored, or a client
// bug reads as "the list just stops".
func TestListEndpointsRejectMalformedCursor(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, 1)

	for _, path := range []string{"/api/favorites", "/api/trash", "/api/memories"} {
		req := httptest.NewRequest(http.MethodGet, path+"?cursor=not-a-cursor", nil)
		req.AddCookie(f.cookie)
		rec := httptest.NewRecorder()
		f.router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s with a bad cursor = %d, want 400", path, rec.Code)
		}
	}
}

type paginationFixture struct {
	db     *sql.DB
	router http.Handler
	cookie *http.Cookie
}

func seedPaginationLibrary(t *testing.T, ctx context.Context, n int) paginationFixture {
	t.Helper()
	dataDir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(dataDir)
	if err != nil {
		t.Fatal(err)
	}

	sourceDir := t.TempDir()
	for i := 0; i < n; i++ {
		// Distinct pixels per file: the importer dedups on BLAKE3 of the
		// content, so identical JPEGs would import as one asset and every
		// pagination assertion below would be vacuous.
		writeDistinctJPEG(t, filepath.Join(sourceDir, fmt.Sprintf("IMG_%04d.jpg", i)), i)
	}
	runner := importer.Importer{DB: database, Store: store, Media: media.NewPureGo()}
	result, err := runner.Run(ctx, importer.Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != n {
		t.Fatalf("imported %d of %d; the fixtures are not distinct", result.Imported, n)
	}

	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	return paginationFixture{db: database, router: router, cookie: setupTestSession(t, router)}
}

func mustExec(t *testing.T, ctx context.Context, database *sql.DB, query string) {
	t.Helper()
	if _, err := database.ExecContext(ctx, query); err != nil {
		t.Fatal(err)
	}
}

// createTestAlbum makes an album holding every asset in the library.
func createTestAlbum(t *testing.T, f paginationFixture) string {
	t.Helper()
	rec := postJSON(t, f.router, "/api/albums", map[string]string{"name": "All"}, f.cookie)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("create album = %d body=%s", rec.Code, rec.Body.String())
	}
	var album struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}

	rows, err := f.db.Query(`SELECT id FROM assets`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	add := postJSON(t, f.router, "/api/albums/"+album.ID+"/assets", map[string][]string{"ids": ids}, f.cookie)
	if add.Code != http.StatusOK {
		t.Fatalf("add to album = %d body=%s", add.Code, add.Body.String())
	}
	return album.ID
}

func writeDistinctJPEG(t *testing.T, path string, seed int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			img.Set(x, y, color.RGBA{R: uint8((x*20 + seed*7) % 256), G: uint8((y*30 + seed*13) % 256), B: uint8(seed * 31 % 256), A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatal(err)
	}
}
