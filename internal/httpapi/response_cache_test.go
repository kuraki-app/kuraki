package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

func TestResponseCacheExpiresAndEvictsLeastRecentlyUsed(t *testing.T) {
	cache := newResponseCache(time.Second, 2, 16)
	now := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return now }
	cache.put("one", []byte("one"), "application/json")
	cache.put("two", []byte("two"), "application/json")
	if _, ok := cache.get("one"); !ok {
		t.Fatal("expected first entry to be readable")
	}
	cache.put("three", []byte("three"), "application/json")
	if _, ok := cache.get("two"); ok {
		t.Fatal("least-recently-used entry survived eviction")
	}
	now = now.Add(time.Second)
	if _, ok := cache.get("one"); ok {
		t.Fatal("expired entry was returned")
	}
}

func TestCacheReadHitsAndWriteInvalidates(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	seedOwnedAsset(t, database, "cache-asset")

	get := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("assets status = %d body=%s", rec.Code, rec.Body.String())
		}
		return rec
	}
	if got := get().Header().Get("X-Kuraki-Cache"); got != "miss" {
		t.Fatalf("first read cache = %q, want miss", got)
	}
	if got := get().Header().Get("X-Kuraki-Cache"); got != "hit" {
		t.Fatalf("second read cache = %q, want hit", got)
	}

	rec := postJSON(t, router, "/api/assets/cache-asset/favorite", apitypes.FavoriteRequest{Favorite: true}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("favorite status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := get().Header().Get("X-Kuraki-Cache"); got != "miss" {
		t.Fatalf("read after mutation cache = %q, want miss", got)
	}
}
