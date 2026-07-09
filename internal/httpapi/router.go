// Package httpapi wires the HTTP surface: JSON API under /api, health/metrics,
// and the embedded single-page UI as a fallthrough (F-01, F-06).
package httpapi

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Deps are the collaborators the HTTP layer needs. Kept minimal in M0; grows
// as handlers land (auth, assets, search).
type Deps struct {
	Version string
	DB      *sql.DB
	Logger  *slog.Logger
}

// NewRouter builds the top-level HTTP handler.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", d.healthz)
	r.Get("/metrics", d.metrics) // expvar-backed; expanded later

	r.Route("/api", func(r chi.Router) {
		r.Get("/status", d.status)
	})

	// Everything else falls through to the embedded SPA.
	r.Handle("/*", spaHandler(uiFS()))
	return r
}

func (d Deps) healthz(w http.ResponseWriter, r *http.Request) {
	if d.DB != nil {
		if err := d.DB.PingContext(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "db_unavailable",
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":    "kuraki",
		"version": d.Version,
	})
}

func (d Deps) metrics(w http.ResponseWriter, r *http.Request) {
	// Placeholder; a real /metrics (idle-RAM, import counters) lands in M2.
	writeJSON(w, http.StatusOK, map[string]string{"metrics": "not_yet_implemented"})
}

// spaHandler serves static files from the embedded UI, falling back to
// index.html for unknown paths so client-side routing works (F-06).
func spaHandler(files fs.FS) http.HandlerFunc {
	fileServer := http.FileServer(http.FS(files))
	return func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean(r.URL.Path)
		if p == "/" {
			p = "/index.html"
		}
		if f, err := files.Open(p[1:]); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		} else if !os.IsNotExist(err) {
			// Unexpected error opening embedded asset.
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		// SPA fallback.
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
