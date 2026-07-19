package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func deviceFavoriteRouter(t *testing.T) (http.Handler, *http.Cookie, *sql.DB) {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := queue.New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Queue: q, Logger: slog.Default()})
	cookie := setupTestSession(t, router)
	return router, cookie, database
}

// registerTestDevice pairs a device the normal way and returns its bearer token.
func registerTestDevice(t *testing.T, router http.Handler, cookie *http.Cookie) string {
	t.Helper()
	rec := postJSON(t, router, "/api/devices", apitypes.DeviceRequest{Name: "Test phone"}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("device status = %d body=%s", rec.Code, rec.Body.String())
	}
	var device apitypes.DeviceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}
	return device.Token
}

// seedOwnedAsset inserts a minimal asset owned by the sole Phase-1 user.
func seedOwnedAsset(t *testing.T, database *sql.DB, id string) {
	t.Helper()
	var ownerID string
	if err := database.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	_, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
		VALUES (?, ?, ?, ?, ?, ?, 'image')`, id, ownerID, "hash-"+id, "2026/07/"+id+".jpg", id+".jpg", "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
}

func postFavorite(t *testing.T, router http.Handler, token, id string, fav bool) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(apitypes.FavoriteRequest{Favorite: fav})
	req := httptest.NewRequest(http.MethodPost, "/api/capture/assets/"+id+"/favorite", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDeviceFavoriteSetsOwnedAsset(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, database, "asset-1")

	rec := postFavorite(t, router, token, "asset-1", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("favorite status = %d body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got["favorite"] {
		t.Fatalf("expected favorite true, got %v", got)
	}
}

func TestDeviceFavoriteRejectsNoToken(t *testing.T) {
	router, _, _ := deviceFavoriteRouter(t)
	rec := postFavorite(t, router, "", "asset-1", true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestDeviceFavoriteMissingAssetIs404(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	rec := postFavorite(t, router, token, "does-not-exist", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
