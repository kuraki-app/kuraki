package httpapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// TestSPADocumentNonceCSP proves the embedded SPA document is served with a
// per-request script nonce so SvelteKit's inline bootstrap runs under the strict
// CSP. Without this the app never calls kit.start() and renders a blank shell.
func TestSPADocumentNonceCSP(t *testing.T) {
	router := NewRouter(Deps{Version: "test", Logger: slog.Default()})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	csp := rec.Header().Get("Content-Security-Policy")
	m := regexp.MustCompile(`script-src 'self' 'nonce-([^']+)'`).FindStringSubmatch(csp)
	if m == nil {
		t.Fatalf("SPA document CSP has no script nonce: %q", csp)
	}
	nonce := m[1]
	body := rec.Body.String()
	if !strings.Contains(body, `<script nonce="`+nonce+`">`) {
		t.Fatalf("inline <script> not tagged with the CSP nonce %q", nonce)
	}
	// A bare, un-nonced inline script would still be blocked — none must remain.
	if strings.Contains(body, "<script>") {
		t.Fatal("an inline <script> was left un-nonced")
	}
	// The document must not be cached, or a stale nonce would mismatch a future CSP.
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("SPA document Cache-Control = %q, want no-store", cc)
	}
}

// TestNonDocumentKeepsStrictCSP proves non-HTML responses keep the plain
// script-src 'self' (no nonce) — the nonce is only for the SPA document.
func TestNonDocumentKeepsStrictCSP(t *testing.T) {
	router := NewRouter(Deps{Version: "test", Logger: slog.Default()})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self'") || strings.Contains(csp, "nonce-") {
		t.Fatalf("non-document CSP = %q, want strict script-src 'self' without a nonce", csp)
	}
}

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
