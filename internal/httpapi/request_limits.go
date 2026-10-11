package httpapi

import (
	"net/http"
	"strings"
	"time"
)

const maxJSONBytes = 1 << 20

// boundRequestBodies caps small API operations separately from streamed media.
// Context timeouts do not interrupt a socket blocked reading the request body.
func boundRequestBodies(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		duration := 15 * time.Second
		switch {
		case r.URL.Path == "/api/assets" && r.Method == http.MethodPost:
			duration = 30 * time.Minute
		case strings.HasPrefix(r.URL.Path, "/api/capture/uploads/") && r.Method == http.MethodPatch:
			duration = 2 * time.Minute
		default:
			limit := int64(maxJSONBytes)
			if r.URL.Path == "/api/setup" || r.URL.Path == "/api/login" || r.URL.Path == "/api/account/password" {
				limit = 16 << 10
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(time.Now().Add(duration))
		defer controller.SetReadDeadline(time.Time{})
		next.ServeHTTP(w, r)
	})
}
