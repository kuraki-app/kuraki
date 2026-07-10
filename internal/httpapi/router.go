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
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/storage"
	"golang.org/x/time/rate"
)

// Deps are the collaborators the HTTP layer needs.
type Deps struct {
	Version   string
	DB        *sql.DB
	Store     storage.Storage
	Media     media.Processor
	Queue     *queue.Queue
	ThumbSize int
	Logger    *slog.Logger
}

// NewRouter builds the top-level HTTP handler.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	// Compress text responses (JSON API + UI bundles); media types are skipped
	// so range requests and already-compressed images/videos pass through.
	r.Use(middleware.Compress(5, "application/json", "text/html", "text/css",
		"application/javascript", "text/javascript", "image/svg+xml"))
	r.Use(middleware.Timeout(60 * time.Second))

	// Login throttle: ~10 attempts then 1 per 6s per IP (F-14).
	loginLimiter := newIPLimiter(rate.Every(6*time.Second), 10, 10*time.Minute)

	r.Get("/healthz", d.healthz)
	r.Get("/metrics", d.metrics)

	r.Route("/api", func(r chi.Router) {
		r.Get("/status", d.status)
		r.Get("/setup", d.setupStatus)
		r.Post("/setup", d.setup)
		r.With(loginLimiter.middleware).Post("/login", d.login)
		r.Post("/logout", d.logout)
		r.Get("/me", d.me)

		r.Group(func(r chi.Router) {
			r.Use(d.requireAuth)
			r.Get("/assets", d.listAssets)
			r.Post("/assets", d.uploadAsset)
			r.Post("/assets/batch", d.batchAssets)
			r.Post("/assets/zip", d.downloadZip)
			r.Post("/assets/shift-time", d.shiftTime)
			r.Patch("/assets/{id}", d.patchAsset)
			r.Get("/assets/{id}", d.getAsset)
			r.Delete("/assets/{id}", d.deleteAsset)
			r.Post("/assets/{id}/restore", d.restoreAsset)
			r.Get("/assets/{id}/original", d.serveOriginal)
			r.Get("/assets/{id}/thumb", d.serveThumb)
			r.Get("/assets/{id}/preview", d.servePreview)
			r.Post("/assets/{id}/favorite", d.setFavorite)
			r.Get("/search", d.searchAssets)
			r.Get("/favorites", d.listFavorites)
			r.Get("/memories", d.onThisDay)
			r.Get("/trash", d.listTrash)
			r.Get("/places", d.placesAssets)
			r.Get("/places/summary", d.placesSummary)
			r.Get("/stats", d.stats)
			r.Get("/jobs", d.listJobs)
			r.Get("/jobs/{id}", d.getJob)
			r.Get("/media/issues", d.mediaIssues)
			r.Get("/tags", d.listTags)
			r.Post("/tags", d.createTag)
			r.Delete("/tags/{id}", d.deleteTag)
			r.Get("/assets/{id}/tags", d.assetTags)
			r.Put("/assets/{id}/tags", d.replaceAssetTags)
			r.Get("/saved-searches", d.listSavedSearches)
			r.Post("/saved-searches", d.createSavedSearch)
			r.Delete("/saved-searches/{id}", d.deleteSavedSearch)
			r.Get("/external-libraries", d.listExternalLibraries)
			r.Post("/external-libraries", d.createExternalLibrary)
			r.Post("/external-libraries/{id}/scan", d.scanExternalLibrary)

			r.Get("/albums", d.listAlbums)
			r.Post("/albums", d.createAlbum)
			r.Get("/albums/{id}", d.getAlbum)
			r.Patch("/albums/{id}", d.renameAlbum)
			r.Delete("/albums/{id}", d.deleteAlbum)
			r.Post("/albums/{id}/assets", d.addAlbumAssets)
			r.Delete("/albums/{id}/assets", d.removeAlbumAssets)
		})
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
			// Hashed build assets never change under their URL — cache forever.
			if strings.HasPrefix(p, "/_app/immutable/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
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
