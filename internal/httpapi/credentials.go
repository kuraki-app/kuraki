package httpapi

import (
	"net/http"
	"strings"
)

// Bound Argon2 allocations across clients, including first-run requests that
// pass the early setup check together. Reject overflow rather than queue work.
func credentialConcurrency(slots chan struct{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			credentialWrite := r.Method != http.MethodGet &&
				(path == "/api/setup" || path == "/api/login" || path == "/api/account/password" ||
					path == "/api/users" || strings.HasPrefix(path, "/api/users/"))
			if !credentialWrite {
				next.ServeHTTP(w, r)
				return
			}
			if r.Context().Err() != nil {
				writeError(w, http.StatusRequestTimeout, "request_cancelled")
				return
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
				next.ServeHTTP(w, r)
			default:
				w.Header().Set("Retry-After", "1")
				writeError(w, http.StatusServiceUnavailable, "credential_work_busy")
			}
		})
	}
}
