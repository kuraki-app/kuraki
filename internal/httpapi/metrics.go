package httpapi

import (
	"crypto/subtle"
	"net/http"
	"runtime"
	"strings"
	"time"
)

var processStart = time.Now()

// requireMetricsAuth guards /metrics so its library counters (asset count,
// storage bytes) and runtime stats are not exposed to anonymous callers. A
// logged-in owner session always passes; scrapers that cannot hold a session
// present "Authorization: Bearer <KURAKI_METRICS_TOKEN>" instead.
func (d Deps) requireMetricsAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if d.MetricsToken != "" {
			if tok, ok := bearerToken(r); ok &&
				subtle.ConstantTimeCompare([]byte(tok), []byte(d.MetricsToken)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
		}
		if d.currentUser(r) != nil {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
	})
}

// bearerToken extracts the credential from an "Authorization: Bearer <token>"
// header, reporting whether one was present.
func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", false
	}
	return strings.TrimSpace(h[len(prefix):]), true
}

// metrics reports runtime and library counters so Kuraki can be monitored like
// any other service (idle RAM is a headline goal). JSON keeps it dependency-free;
// a Prometheus exposition format can be added later behind content negotiation.
func (d Deps) metrics(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	out := map[string]any{
		"version":          d.Version,
		"uptime_seconds":   int64(time.Since(processStart).Seconds()),
		"goroutines":       runtime.NumGoroutine(),
		"mem_alloc_bytes":  m.Alloc,
		"mem_sys_bytes":    m.Sys,
		"mem_heap_objects": m.HeapObjects,
		"gc_num":           m.NumGC,
	}
	if d.DB != nil {
		if n, err := scalarInt(r, d, `SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL`); err == nil {
			out["assets_total"] = n
		}
		if n, err := scalarInt(r, d, `SELECT COUNT(*) FROM assets WHERE deleted_at IS NOT NULL`); err == nil {
			out["assets_trashed"] = n
		}
		if n, err := scalarInt(r, d, `SELECT COALESCE(SUM(size_bytes),0) FROM assets WHERE deleted_at IS NULL`); err == nil {
			out["library_bytes"] = n
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func scalarInt(r *http.Request, d Deps, query string) (int64, error) {
	var n int64
	err := d.DB.QueryRowContext(r.Context(), query).Scan(&n)
	return n, err
}
