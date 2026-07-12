package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

// securityHeaders establishes a conservative browser policy for the embedded
// single-origin SPA. The app has no third-party scripts, frames, or plugins.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(self)")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'")
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
