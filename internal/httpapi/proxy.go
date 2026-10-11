package httpapi

import (
	"net"
	"net/http"
	"strings"
)

// trustedForwardedIP uses only the header the shipped proxy overwrites. Chi's
// general RealIP middleware prefers True-Client-IP and X-Real-IP, which Caddy
// passes through and an external client can forge. Enable only on a private
// listener behind a proxy that supplies the complete X-Forwarded-For chain.
func trustedForwardedIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.Header.Get("X-Forwarded-For"); header != "" {
			first, _, _ := strings.Cut(header, ",")
			if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
				r.RemoteAddr = ip.String()
			}
		}
		next.ServeHTTP(w, r)
	})
}
