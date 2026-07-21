package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
)

// contentSecurityPolicy returns the app's CSP. With an empty nonce the script
// source is the plain `script-src 'self'` used for every response. The SPA
// document (see spaHandler) passes a per-request nonce so SvelteKit's inline
// bootstrap <script> blocks are admitted without opening the policy to all
// inline script via 'unsafe-inline'.
func contentSecurityPolicy(scriptNonce string) string {
	script := "script-src 'self'"
	if scriptNonce != "" {
		script = "script-src 'self' 'nonce-" + scriptNonce + "'"
	}
	return "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; " +
		"img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; " +
		"style-src 'self' 'unsafe-inline'; " + script
}

// newCSPNonce returns a fresh base64 nonce for a single SPA document response.
func newCSPNonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error on supported platforms
	return base64.StdEncoding.EncodeToString(b)
}

// securityHeaders establishes a conservative browser policy for the embedded
// single-origin SPA. The app has no third-party scripts, frames, or plugins.
// The SPA document overrides the CSP with a nonce variant (spaHandler); every
// other response keeps the strict default set here.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(self)")
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy(""))
		next.ServeHTTP(w, r)
	})
}

// sameOriginWrites rejects browser cross-origin state changes. Requests without
// an Origin header (CLI/curl) retain their existing authenticated behavior.
func sameOriginWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || !strings.EqualFold(u.Host, r.Host) {
			writeError(w, http.StatusForbidden, "cross_origin_request")
			return
		}
		next.ServeHTTP(w, r)
	})
}
