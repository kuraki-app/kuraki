package httpapi

import (
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type requestMetricKey struct {
	Method string `json:"method"`
	Route  string `json:"route"`
	Status int    `json:"status"`
}

type requestMetric struct {
	requestMetricKey
	Requests        uint64  `json:"requests"`
	DurationSeconds float64 `json:"duration_seconds"`
	ResponseBytes   uint64  `json:"response_bytes"`
}

type requestMetricValue struct {
	requests uint64
	duration time.Duration
	bytes    uint64
}

type requestMetrics struct {
	mu     sync.RWMutex
	values map[requestMetricKey]requestMetricValue
}

func newRequestMetrics() *requestMetrics {
	return &requestMetrics{values: make(map[requestMetricKey]requestMetricValue)}
}

func (m *requestMetrics) record(key requestMetricKey, duration time.Duration, bytes int) {
	m.mu.Lock()
	value := m.values[key]
	value.requests++
	value.duration += duration
	if bytes > 0 {
		value.bytes += uint64(bytes)
	}
	m.values[key] = value
	m.mu.Unlock()
}

func (m *requestMetrics) snapshot() []requestMetric {
	m.mu.RLock()
	out := make([]requestMetric, 0, len(m.values))
	for key, value := range m.values {
		out = append(out, requestMetric{
			requestMetricKey: key,
			Requests:         value.requests,
			DurationSeconds:  value.duration.Seconds(),
			ResponseBytes:    value.bytes,
		})
	}
	m.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if out[i].Route != out[j].Route {
			return out[i].Route < out[j].Route
		}
		if out[i].Method != out[j].Method {
			return out[i].Method < out[j].Method
		}
		return out[i].Status < out[j].Status
	})
	return out
}

func (d Deps) observeRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)

		status := wrapped.Status()
		if status == 0 {
			status = http.StatusOK
		}
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		duration := time.Since(started)
		d.requests.record(requestMetricKey{Method: normalizedMetricMethod(r.Method), Route: route, Status: status}, duration, wrapped.BytesWritten())

		// The SPA can request hundreds of immutable chunks in one navigation.
		// Keep their counters, but avoid turning ordinary browser use into a
		// screenful of identical info logs. Errors remain visible everywhere.
		if d.Logger == nil || (status < http.StatusBadRequest &&
			!strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/metrics" && r.URL.Path != "/healthz") {
			return
		}
		level := slog.LevelInfo
		if status >= 500 {
			level = slog.LevelError
		} else if status >= 400 {
			level = slog.LevelWarn
		}
		d.Logger.Log(r.Context(), level, "http request complete",
			"request_id", middleware.GetReqID(r.Context()),
			"method", r.Method,
			"route", route,
			"status", status,
			"duration_ms", duration.Milliseconds(),
			"bytes", wrapped.BytesWritten(),
			"remote_addr", r.RemoteAddr,
			"error", requestErrorClass(status),
		)
	})
}

func normalizedMetricMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodConnect, http.MethodTrace:
		return method
	default:
		return "OTHER"
	}
}

func requestErrorClass(status int) string {
	if status < 400 {
		return ""
	}
	return strconv.Itoa(status/100) + "xx"
}
