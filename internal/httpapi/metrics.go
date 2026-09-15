package httpapi

import (
	"crypto/subtle"
	"database/sql"
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var processStart = time.Now()

var jobStatuses = []string{"queued", "running", "succeeded", "failed"}

type jobMetrics struct {
	ByStatus   map[string]int64 `json:"by_status"`
	Imported   int64            `json:"imported_total"`
	Duplicates int64            `json:"duplicates_total"`
	Skipped    int64            `json:"skipped_total"`
	Errors     int64            `json:"errors_total"`
	Attempts   int64            `json:"attempts_total"`
}

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
// any other service (idle RAM is a headline goal). JSON remains the default;
// Prometheus text is available through standard Accept negotiation.
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
		stats := d.DB.Stats()
		out["database"] = map[string]int64{
			"open_connections":     int64(stats.OpenConnections),
			"in_use_connections":   int64(stats.InUse),
			"idle_connections":     int64(stats.Idle),
			"wait_count":           stats.WaitCount,
			"wait_duration_millis": stats.WaitDuration.Milliseconds(),
			"max_idle_closed":      stats.MaxIdleClosed,
			"max_lifetime_closed":  stats.MaxLifetimeClosed,
		}
		if jobs, err := readJobMetrics(r, d.DB); err == nil {
			out["jobs"] = jobs
		}
	}
	httpMetrics := d.requests.snapshot()
	out["http"] = httpMetrics
	if d.responses != nil {
		out["cache"] = d.responses.stats()
	}
	if strings.Contains(r.Header.Get("Accept"), "text/plain") {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		for _, key := range []string{"uptime_seconds", "goroutines", "mem_alloc_bytes", "mem_sys_bytes", "mem_heap_objects", "gc_num", "assets_total", "assets_trashed", "library_bytes"} {
			if value, ok := out[key]; ok {
				_, _ = fmt.Fprintf(w, "kuraki_%s %v\n", key, value)
			}
		}
		if database, ok := out["database"].(map[string]int64); ok {
			for _, key := range []string{"open_connections", "in_use_connections", "idle_connections", "wait_count", "wait_duration_millis", "max_idle_closed", "max_lifetime_closed"} {
				_, _ = fmt.Fprintf(w, "kuraki_database_%s %d\n", key, database[key])
			}
		}
		if jobs, ok := out["jobs"].(jobMetrics); ok {
			for _, status := range jobStatuses {
				_, _ = fmt.Fprintf(w, "kuraki_jobs{status=%s} %d\n", strconv.Quote(status), jobs.ByStatus[status])
			}
			_, _ = fmt.Fprintf(w, "kuraki_job_imported_total %d\n", jobs.Imported)
			_, _ = fmt.Fprintf(w, "kuraki_job_duplicates_total %d\n", jobs.Duplicates)
			_, _ = fmt.Fprintf(w, "kuraki_job_skipped_total %d\n", jobs.Skipped)
			_, _ = fmt.Fprintf(w, "kuraki_job_errors_total %d\n", jobs.Errors)
			_, _ = fmt.Fprintf(w, "kuraki_job_attempts_total %d\n", jobs.Attempts)
		}
		for _, metric := range httpMetrics {
			labels := fmt.Sprintf("method=%s,route=%s,status=%s", strconv.Quote(metric.Method), strconv.Quote(metric.Route), strconv.Quote(strconv.Itoa(metric.Status)))
			_, _ = fmt.Fprintf(w, "kuraki_http_requests_total{%s} %d\n", labels, metric.Requests)
			_, _ = fmt.Fprintf(w, "kuraki_http_request_duration_seconds_sum{%s} %g\n", labels, metric.DurationSeconds)
			_, _ = fmt.Fprintf(w, "kuraki_http_request_duration_seconds_count{%s} %d\n", labels, metric.Requests)
			_, _ = fmt.Fprintf(w, "kuraki_http_response_bytes_total{%s} %d\n", labels, metric.ResponseBytes)
		}
		if cache, ok := out["cache"].(responseCacheStats); ok {
			_, _ = fmt.Fprintf(w, "kuraki_cache_hits_total %d\n", cache.Hits)
			_, _ = fmt.Fprintf(w, "kuraki_cache_misses_total %d\n", cache.Misses)
			_, _ = fmt.Fprintf(w, "kuraki_cache_entries %d\n", cache.Entries)
			_, _ = fmt.Fprintf(w, "kuraki_cache_bytes %d\n", cache.Bytes)
		}
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func readJobMetrics(r *http.Request, db *sql.DB) (jobMetrics, error) {
	out := jobMetrics{ByStatus: make(map[string]int64, len(jobStatuses))}
	for _, status := range jobStatuses {
		out.ByStatus[status] = 0
	}
	rows, err := db.QueryContext(r.Context(), `SELECT status, COUNT(*) FROM jobs GROUP BY status`)
	if err != nil {
		return out, fmt.Errorf("metrics: query job states: %w", err)
	}
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return out, fmt.Errorf("metrics: scan job state: %w", err)
		}
		if _, known := out.ByStatus[status]; known {
			out.ByStatus[status] = count
		}
	}
	if err := rows.Close(); err != nil {
		return out, fmt.Errorf("metrics: close job states: %w", err)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("metrics: iterate job states: %w", err)
	}
	if err := db.QueryRowContext(r.Context(), `
		SELECT COALESCE(SUM(imported),0), COALESCE(SUM(duplicates),0),
		       COALESCE(SUM(skipped),0), COALESCE(SUM(errors),0), COALESCE(SUM(attempts),0)
		FROM jobs`).Scan(&out.Imported, &out.Duplicates, &out.Skipped, &out.Errors, &out.Attempts); err != nil {
		return out, fmt.Errorf("metrics: query job totals: %w", err)
	}
	return out, nil
}

func scalarInt(r *http.Request, d Deps, query string) (int64, error) {
	var n int64
	err := d.DB.QueryRowContext(r.Context(), query).Scan(&n)
	return n, err
}
