package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	for name, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "same-origin",
	} {
		if got := rec.Header().Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}

func TestSameOriginWrites(t *testing.T) {
	h := sameOriginWrites(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	blocked := httptest.NewRequest(http.MethodPost, "http://photos.example.test/api/assets", nil)
	blocked.Header.Set("Origin", "https://attacker.example.test")
	blockedRec := httptest.NewRecorder()
	h.ServeHTTP(blockedRec, blocked)
	if blockedRec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d, want 403", blockedRec.Code)
	}
	allowed := httptest.NewRequest(http.MethodPost, "https://photos.example.test/api/assets", nil)
	allowed.Header.Set("Origin", "https://photos.example.test")
	allowedRec := httptest.NewRecorder()
	h.ServeHTTP(allowedRec, allowed)
	if allowedRec.Code != http.StatusNoContent {
		t.Fatalf("same-origin status = %d, want 204", allowedRec.Code)
	}
}
