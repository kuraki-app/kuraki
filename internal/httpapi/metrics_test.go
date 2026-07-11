package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func newMetricsRouter(t *testing.T, token string) http.Handler {
	t.Helper()
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
	return NewRouter(Deps{Version: "test", DB: database, Store: store, MetricsToken: token, Logger: slog.Default()})
}

func getMetrics(t *testing.T, h http.Handler, auth string, cookie *http.Cookie) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestMetricsRequiresAuth(t *testing.T) {
	router := newMetricsRouter(t, "")

	// No session, no token configured: anonymous callers are rejected so
	// library counters and storage size do not leak.
	if code := getMetrics(t, router, "", nil); code != http.StatusUnauthorized {
		t.Fatalf("anonymous /metrics = %d, want 401", code)
	}

	// An owner session always passes.
	setupRec := postJSON(t, router, "/api/setup", credentialsRequest{Username: "owner", Password: "correct horse"}, nil)
	if setupRec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d", setupRec.Code)
	}
	cookie := findCookie(setupRec.Result().Cookies(), sessionCookieName)
	if code := getMetrics(t, router, "", cookie); code != http.StatusOK {
		t.Fatalf("session /metrics = %d, want 200", code)
	}
}

func TestMetricsBearerToken(t *testing.T) {
	router := newMetricsRouter(t, "s3cret-scrape-token")

	if code := getMetrics(t, router, "Bearer s3cret-scrape-token", nil); code != http.StatusOK {
		t.Fatalf("correct bearer /metrics = %d, want 200", code)
	}
	if code := getMetrics(t, router, "Bearer wrong-token", nil); code != http.StatusUnauthorized {
		t.Fatalf("wrong bearer /metrics = %d, want 401", code)
	}
	if code := getMetrics(t, router, "", nil); code != http.StatusUnauthorized {
		t.Fatalf("missing bearer /metrics = %d, want 401", code)
	}
}
