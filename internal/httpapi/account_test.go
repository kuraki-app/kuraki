package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// setupOwner runs first-time setup and returns the owner's session cookie.
func setupOwner(t *testing.T, router http.Handler, password string) *http.Cookie {
	t.Helper()
	rec := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "owner", Password: password}, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup status = %d, want 201", rec.Code)
	}
	cookie := findCookie(rec.Result().Cookies(), sessionCookieName)
	if cookie == nil {
		t.Fatal("setup returned no session cookie")
	}
	return cookie
}

func TestChangePassword(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	cookie := setupOwner(t, router, "correct horse")

	// Wrong current password is rejected.
	rec := postJSON(t, router, "/api/account/password",
		apitypes.ChangePasswordRequest{CurrentPassword: "nope", NewPassword: "brand new secret"}, cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current password = %d, want 401", rec.Code)
	}

	// Too-short new password is rejected.
	rec = postJSON(t, router, "/api/account/password",
		apitypes.ChangePasswordRequest{CurrentPassword: "correct horse", NewPassword: "short"}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("short new password = %d, want 400", rec.Code)
	}

	// Correct change succeeds.
	rec = postJSON(t, router, "/api/account/password",
		apitypes.ChangePasswordRequest{CurrentPassword: "correct horse", NewPassword: "brand new secret"}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid change = %d, want 200", rec.Code)
	}

	// The old password no longer logs in; the new one does.
	if rec := postJSON(t, router, "/api/login",
		apitypes.Credentials{Username: "owner", Password: "correct horse"}, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("login with old password = %d, want 401", rec.Code)
	}
	if rec := postJSON(t, router, "/api/login",
		apitypes.Credentials{Username: "owner", Password: "brand new secret"}, nil); rec.Code != http.StatusOK {
		t.Fatalf("login with new password = %d, want 200", rec.Code)
	}
}

func TestChangePasswordInvalidatesOtherSessions(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	first := setupOwner(t, router, "correct horse")

	// Open a second session by logging in again.
	loginRec := postJSON(t, router, "/api/login",
		apitypes.Credentials{Username: "owner", Password: "correct horse"}, nil)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("second login = %d", loginRec.Code)
	}
	second := findCookie(loginRec.Result().Cookies(), sessionCookieName)

	// Change the password using the first session.
	rec := postJSON(t, router, "/api/account/password",
		apitypes.ChangePasswordRequest{CurrentPassword: "correct horse", NewPassword: "brand new secret"}, first)
	if rec.Code != http.StatusOK {
		t.Fatalf("change = %d, want 200", rec.Code)
	}

	// The first (caller's) session still works.
	if !meAuthed(t, router, first) {
		t.Fatal("caller session should survive its own password change")
	}
	// The second session was invalidated.
	if meAuthed(t, router, second) {
		t.Fatal("other session should be signed out after password change")
	}
}

// meAuthed reports whether the cookie still resolves to an authenticated user.
func meAuthed(t *testing.T, handler http.Handler, cookie *http.Cookie) bool {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Code == http.StatusOK
}
