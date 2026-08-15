package httpapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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
	// securityHeaders is now parameterised by whether the operator declared
	// HTTPS; false is the default deployment and the case this test covers.
	h := securityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
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

// TestMapTileHostIsPermitted proves the CSP admits whatever tile host the web
// client actually asks for.
//
// This is checked against the web source rather than against a constant, because
// the failure it guards is a *disagreement* between two files that nothing
// otherwise connects. Places shipped requesting tiles from openstreetmap.org
// while img-src was 'self' data: blob:, so the browser blocked every tile and
// the map rendered as bare grey with clusters floating on it — for every user,
// from the day it shipped. Neither `go test` nor `svelte-check` nor a clean
// `npm run build` can see that; only a browser can, and the project had none.
//
// Changing the tile provider in the Svelte file without widening the CSP now
// fails here instead of silently blanking the map.
func TestMapTileHostIsPermitted(t *testing.T) {
	const places = "../../web/src/routes/places/+page.svelte"
	src, err := os.ReadFile(places)
	if err != nil {
		t.Skipf("web source not available: %v", err)
	}

	m := regexp.MustCompile(`L\.tileLayer\(\s*'https://([^/']+)`).FindSubmatch(src)
	if m == nil {
		// The map may have been rewritten (see the leaflet/MapLibre split noted
		// in the audit). Failing loudly is right: this test's premise is gone.
		t.Fatalf("no L.tileLayer('https://…') found in %s — update this test alongside the map", places)
	}

	// Leaflet's {s} placeholder expands to per-subdomain hosts, so compare on the
	// registrable part rather than the literal template.
	host := strings.TrimPrefix(string(m[1]), "{s}.")
	csp := contentSecurityPolicy("")

	imgSrc := ""
	for _, directive := range strings.Split(csp, ";") {
		if d := strings.TrimSpace(directive); strings.HasPrefix(d, "img-src ") {
			imgSrc = d
		}
	}
	if imgSrc == "" {
		t.Fatalf("CSP has no img-src directive: %q", csp)
	}
	if !strings.Contains(imgSrc, host) {
		t.Fatalf("map requests tiles from %q but img-src does not permit it: %q", host, imgSrc)
	}
}

// TestHSTSOnlyWhenBehindHTTPS proves the header follows the operator's own
// declaration rather than being sent unconditionally.
//
// This matters more than a typical header check. A browser that sees HSTS once
// refuses plain HTTP for that host until the max-age expires, and the default
// deployment of a self-hosted photo server is http://a-box-on-my-LAN:3000.
// Sending it there would lock someone out of their own library with no
// server-side way to undo it.
func TestHSTSOnlyWhenBehindHTTPS(t *testing.T) {
	for _, tc := range []struct {
		name          string
		secureCookies bool
		want          bool
	}{
		{"plain http deployment", false, false},
		{"operator declared HTTPS", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := NewRouter(Deps{Version: "test", SecureCookies: tc.secureCookies})
			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			got := rec.Header().Get("Strict-Transport-Security") != ""
			if got != tc.want {
				t.Fatalf("Strict-Transport-Security present = %v, want %v (header=%q)",
					got, tc.want, rec.Header().Get("Strict-Transport-Security"))
			}
		})
	}
}
