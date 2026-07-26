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

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func TestSetupDefaultsUsernameToAdmin(t *testing.T) {
	router, _ := newAuthTestRouter(t)

	// A blank username on first-run setup lands as "admin" (the web form's
	// default), not the internal "owner" placeholder name.
	rec := postJSON(t, router, "/api/setup",
		apitypes.Credentials{Username: "", Password: "correct horse"}, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d body = %s", rec.Code, rec.Body.String())
	}
	var resp apitypes.SetupStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	if resp.User == nil || resp.User.Username != "admin" {
		t.Fatalf("default username = %+v, want admin", resp.User)
	}
	if code := postJSON(t, router, "/api/login",
		apitypes.Credentials{Username: "admin", Password: "correct horse"}, nil).Code; code != http.StatusOK {
		t.Fatalf("login as admin = %d, want 200", code)
	}
}

func TestSetupLoginAndProtectedAPI(t *testing.T) {
	router, _ := newAuthTestRouter(t)

	initial := getJSONWithCookie[apitypes.SetupStatus](t, router, "/api/setup", nil)
	if !initial.SetupRequired {
		t.Fatal("setup should be required for a fresh database")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("pre-setup assets status = %d, want 403", rec.Code)
	}

	setupRec := postJSON(t, router, "/api/setup", apitypes.Credentials{
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

	loginRec := postJSON(t, router, "/api/login", apitypes.Credentials{
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

func TestSecureCookieFlag(t *testing.T) {
	ctx := context.Background()
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
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, SecureCookies: true, Logger: slog.Default()})

	rec := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "owner", Password: "correct horse"}, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d", rec.Code)
	}
	cookie := findCookie(rec.Result().Cookies(), sessionCookieName)
	if cookie == nil || !cookie.Secure {
		t.Fatalf("session cookie Secure flag not set: %+v", cookie)
	}
	if !cookie.HttpOnly {
		t.Fatal("session cookie should stay HttpOnly")
	}
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

func getJSON(t *testing.T, handler http.Handler, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
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
