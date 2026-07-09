package httpapi

import (
	"net/http"
	"runtime"
	"time"
)

var processStart = time.Now()

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
