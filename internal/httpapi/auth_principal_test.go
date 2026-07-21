package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// probeRouter mounts requirePrincipal around a handler that echoes the
// resolved principal as JSON. It shares the DB created by
// deviceFavoriteRouter so cookies/tokens minted against that DB resolve here
// too, without changing any real route (Task 1 is middleware-only).
func probeRouter(db *sql.DB) http.Handler {
	d := Deps{Version: "test", DB: db}
	mux := http.NewServeMux()
	mux.Handle("/probe", d.requirePrincipal(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := principalFrom(r)
		writeJSON(w, http.StatusOK, p)
	})))
	return mux
}

func probeRequest(db *sql.DB, mutate func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	probeRouter(db).ServeHTTP(rec, req)
	return rec
}

// probePrincipal proves the middleware resolved a principal by decoding the
// probe handler's echoed JSON.
func probePrincipal(t *testing.T, db *sql.DB, mutate func(*http.Request)) principal {
	t.Helper()
	rec := probeRequest(db, mutate)
	if rec.Code != http.StatusOK {
		t.Fatalf("probe status = %d body=%s", rec.Code, rec.Body.String())
	}
	var got principal
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode principal: %v", err)
	}
	return got
}

// probePrincipalCode is for the no-credential case, where the probe handler
// never runs and there is no principal body to decode.
func probePrincipalCode(t *testing.T, db *sql.DB) int {
	t.Helper()
	return probeRequest(db, nil).Code
}

func withCookie(cookie *http.Cookie) func(*http.Request) {
	return func(r *http.Request) {
		r.AddCookie(cookie)
	}
}

func withBearer(token string) func(*http.Request) {
	return func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+token)
	}
}

// TestRequirePrincipalSession proves a cookie principal resolves to the owner.
func TestRequirePrincipalSession(t *testing.T) {
	_, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "a1")
	got := probePrincipal(t, db, withCookie(cookie))
	if got.Kind != principalSession {
		t.Fatalf("kind = %v, want session", got.Kind)
	}
	if got.OwnerID == "" {
		t.Fatal("session principal has empty owner")
	}
}

// TestRequirePrincipalDevice proves a Bearer principal resolves to the device owner.
func TestRequirePrincipalDevice(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")
	got := probePrincipal(t, db, withBearer(token))
	if got.Kind != principalDevice {
		t.Fatalf("kind = %v, want device", got.Kind)
	}
	if got.DeviceID == "" {
		t.Fatal("device principal has empty device id")
	}
}

// TestRequirePrincipalNone proves no credential is 401.
func TestRequirePrincipalNone(t *testing.T) {
	_, _, db := deviceFavoriteRouter(t)
	if code := probePrincipalCode(t, db); code != http.StatusUnauthorized {
		t.Fatalf("no creds = %d, want 401", code)
	}
}
