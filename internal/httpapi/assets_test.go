package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/saranshhardaha/kuraki/internal/db"
	"github.com/saranshhardaha/kuraki/internal/importer"
	"github.com/saranshhardaha/kuraki/internal/media"
	"github.com/saranshhardaha/kuraki/internal/storage"
)

func TestAssetAPIListSearchAndServeFiles(t *testing.T) {
	ctx := context.Background()
	database, store, sourceDir := seedHTTPAsset(t, ctx)
	router := NewRouter(Deps{
		Version: "test",
		DB:      database,
		Store:   store,
		Logger:  slog.Default(),
	})
	cookie := setupTestSession(t, router)

	list := getJSONWithCookie[assetListResponse](t, router, "/api/assets", cookie)
	if len(list.Assets) != 1 {
		t.Fatalf("assets len = %d, want 1", len(list.Assets))
	}
	asset := list.Assets[0]
	if asset.Filename != "IMG_0001.jpg" || asset.ThumbnailURL == nil {
		t.Fatalf("asset = %+v, want filename and thumb URL", asset)
	}

	detail := getJSONWithCookie[assetDTO](t, router, "/api/assets/"+asset.ID, cookie)
	if detail.ID != asset.ID {
		t.Fatalf("detail id = %q, want %q", detail.ID, asset.ID)
	}

	search := getJSONWithCookie[assetListResponse](t, router, "/api/search?q=IMG_0001", cookie)
	if len(search.Assets) != 1 || search.Assets[0].ID != asset.ID {
		t.Fatalf("search = %+v, want imported asset", search)
	}

	assertServes(t, router, "/api/assets/"+asset.ID+"/original", "image/jpeg", cookie)
	assertServes(t, router, "/api/assets/"+asset.ID+"/thumb", "image/jpeg", cookie)

	_ = sourceDir
}

func TestAssetAPIEmptyListReturnsArray(t *testing.T) {
	ctx := context.Background()
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
		t.Fatalf("store: %v", err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	list := getJSONWithCookie[assetListResponse](t, router, "/api/assets", cookie)
	if list.Assets == nil {
		t.Fatal("assets should be an empty array, not null")
	}
	if len(list.Assets) != 0 {
		t.Fatalf("assets len = %d, want 0", len(list.Assets))
	}
}

func seedHTTPAsset(t *testing.T, ctx context.Context) (*sql.DB, storage.Storage, string) {
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
		t.Fatalf("store: %v", err)
	}
	sourceDir := t.TempDir()
	writeHTTPJPEG(t, filepath.Join(sourceDir, "IMG_0001.jpg"))
	runner := importer.Importer{
		DB:    database,
		Store: store,
		Media: media.NewPureGo(),
	}
	result, err := runner.Run(ctx, importer.Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Imported != 1 || len(result.Errors) != 0 {
		t.Fatalf("import result = %+v, want one import", result)
	}
	return database, store, sourceDir
}

func getJSON[T any](t *testing.T, handler http.Handler, path string) T {
	t.Helper()
	return getJSONWithCookie[T](t, handler, path, nil)
}

func getJSONWithCookie[T any](t *testing.T, handler http.Handler, path string, cookie *http.Cookie) T {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d body = %s", path, rec.Code, rec.Body.String())
	}
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return out
}

func assertServes(t *testing.T, handler http.Handler, path, contentType string, cookie *http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d body = %s", path, rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != contentType {
		t.Fatalf("GET %s content-type = %q, want %q", path, got, contentType)
	}
	if rec.Body.Len() == 0 {
		t.Fatalf("GET %s returned empty body", path)
	}
}

func setupTestSession(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	rec := postJSON(t, handler, "/api/setup", credentialsRequest{
		Username: "owner",
		Password: "correct horse",
	}, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d body = %s", rec.Code, rec.Body.String())
	}
	cookie := findCookie(rec.Result().Cookies(), sessionCookieName)
	if cookie == nil || cookie.Value == "" {
		t.Fatal("setup should issue session cookie")
	}
	return cookie
}

func writeHTTPJPEG(t *testing.T, path string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 12))
	for y := 0; y < 12; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 12), G: uint8(y * 18), B: 120, A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create jpeg: %v", err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
}
