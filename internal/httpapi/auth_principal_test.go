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
	if got.OwnerID == "" {
		t.Fatal("device principal has empty owner")
	}
}

// TestRequirePrincipalNone proves no credential is 401.
func TestRequirePrincipalNone(t *testing.T) {
	_, _, db := deviceFavoriteRouter(t)
	if code := probePrincipalCode(t, db); code != http.StatusUnauthorized {
		t.Fatalf("no creds = %d, want 401", code)
	}
}

// probeSessionOnlyRouter mounts requirePrincipal->requireSessionPrincipal->
// echo-200, sharing the DB created by deviceFavoriteRouter so cookies/tokens
// minted against that DB resolve here too.
func probeSessionOnlyRouter(db *sql.DB) http.Handler {
	d := Deps{Version: "test", DB: db}
	mux := http.NewServeMux()
	mux.Handle("/probe", d.requirePrincipal(d.requireSessionPrincipal(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))))
	return mux
}

// probeDeviceOnlyRouter mounts requirePrincipal->requireDevicePrincipal->
// echo-200.
func probeDeviceOnlyRouter(db *sql.DB) http.Handler {
	d := Deps{Version: "test", DB: db}
	mux := http.NewServeMux()
	mux.Handle("/probe", d.requirePrincipal(d.requireDevicePrincipal(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))))
	return mux
}

func probeSessionOnlyCode(t *testing.T, db *sql.DB, mutate func(*http.Request)) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	probeSessionOnlyRouter(db).ServeHTTP(rec, req)
	return rec.Code
}

func probeDeviceOnlyCode(t *testing.T, db *sql.DB, mutate func(*http.Request)) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	probeDeviceOnlyRouter(db).ServeHTTP(rec, req)
	return rec.Code
}

// TestRequireSessionPrincipalRejectsDevice proves the session-only guard
// rejects a device principal (403 session_required) and accepts a session
// principal (200).
func TestRequireSessionPrincipalRejectsDevice(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")
	if code := probeSessionOnlyCode(t, db, withBearer(token)); code != http.StatusForbidden {
		t.Fatalf("device on session-only route = %d, want 403", code)
	}
	if code := probeSessionOnlyCode(t, db, withCookie(cookie)); code != http.StatusOK {
		t.Fatalf("session on session-only route = %d, want 200", code)
	}
}

// TestRequireDevicePrincipalRejectsSession proves the device-only guard
// rejects a session principal (403 device_required) and accepts a device
// principal (200).
func TestRequireDevicePrincipalRejectsSession(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")
	if code := probeDeviceOnlyCode(t, db, withCookie(cookie)); code != http.StatusForbidden {
		t.Fatalf("session on device-only route = %d, want 403", code)
	}
	if code := probeDeviceOnlyCode(t, db, withBearer(token)); code != http.StatusOK {
		t.Fatalf("device on device-only route = %d, want 200", code)
	}
}

// TestSessionOnlyRouteRejectsDeviceToken proves a real session-only route
// (POST /api/devices) rejects a device (Bearer) principal with 403
// session_required, exercising the actual router wiring rather than a probe
// mux.
func TestSessionOnlyRouteRejectsDeviceToken(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)

	rec := deviceJSON(t, router, http.MethodPost, "/api/devices", token, map[string]string{"name": "Second phone"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("device token on session-only route = %d, want 403", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["error"] != "session_required" {
		t.Fatalf("error = %q, want session_required", got["error"])
	}
}

// TestDeviceOnlyRouteRejectsSessionCookie proves a real device-only route
// (GET /api/capture/status) rejects a session (cookie) principal with 403
// device_required, exercising the actual router wiring rather than a probe
// mux.
func TestDeviceOnlyRouteRejectsSessionCookie(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/capture/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("session cookie on device-only route = %d, want 403", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["error"] != "device_required" {
		t.Fatalf("error = %q, want device_required", got["error"])
	}
}
