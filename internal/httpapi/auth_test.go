package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/saranshhardaha/kuraki/internal/db"
	"github.com/saranshhardaha/kuraki/internal/storage"
)

func TestSetupLoginAndProtectedAPI(t *testing.T) {
	router, _ := newAuthTestRouter(t)

	initial := getJSON[setupStatusResponse](t, router, "/api/setup")
	if !initial.SetupRequired {
		t.Fatal("setup should be required for a fresh database")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("pre-setup assets status = %d, want 403", rec.Code)
	}

	setupRec := postJSON(t, router, "/api/setup", credentialsRequest{
		Username: "saransh",
		Password: "correct horse",
	}, nil)
	if setupRec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d body = %s", setupRec.Code, setupRec.Body.String())
	}
	setupCookie := findCookie(setupRec.Result().Cookies(), sessionCookieName)
	if setupCookie == nil || setupCookie.Value == "" {
		t.Fatal("setup should issue a session cookie")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated assets status = %d, want 401", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	req.AddCookie(setupCookie)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated assets status = %d body = %s", rec.Code, rec.Body.String())
	}

	logoutRec := postJSON(t, router, "/api/logout", map[string]string{}, setupCookie)
	if logoutRec.Code != http.StatusOK {
		t.Fatalf("logout status = %d", logoutRec.Code)
	}

	loginRec := postJSON(t, router, "/api/login", credentialsRequest{
		Username: "saransh",
		Password: "correct horse",
	}, nil)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d body = %s", loginRec.Code, loginRec.Body.String())
	}
	if cookie := findCookie(loginRec.Result().Cookies(), sessionCookieName); cookie == nil || cookie.Value == "" {
		t.Fatal("login should issue a session cookie")
	}
}

func newAuthTestRouter(t *testing.T) (http.Handler, *sql.DB) {
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
	return NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()}), database
}

func postJSON(t *testing.T, handler http.Handler, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}
