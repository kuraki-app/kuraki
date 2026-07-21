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
	// SecureCookies marks the session cookie Secure (HTTPS-only) in production.
	SecureCookies bool
	// TrustProxy derives the client IP from X-Forwarded-For / X-Real-IP. Only
	// enable it behind a trusted reverse proxy; otherwise the true TCP peer is
	// used so per-IP rate limits cannot be spoofed away.
	TrustProxy bool
	// MetricsToken optionally guards /metrics for bearer-token scrapers.
	MetricsToken string
	// BackupEnabled reports whether unattended backups are configured, so the
	// dashboard can distinguish "not set up" from "set up but not yet run".
	BackupEnabled bool
	// AndroidAPKPath is the filesystem path served at /download/android. Empty
	// disables the endpoint (404); a missing file also 404s until one is placed.
	AndroidAPKPath string
	// Events pushes change-log wakeups to SSE subscribers (GET /api/events).
	// Optional: nil disables the stream (the endpoint 500s and clients fall back
	// to polling), so tests and non-serve callers need not wire it.
	Events *ChangeBroker
	Logger *slog.Logger
}

// NewRouter builds the top-level HTTP handler.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// RealIP rewrites RemoteAddr from X-Forwarded-For / X-Real-IP, which a client
	// can forge unless a trusted proxy overwrites those headers. Only enable it
	// when explicitly told we sit behind such a proxy, so the login/pairing rate
	// limiters key on the unspoofable TCP peer by default.
	if d.TrustProxy {
		r.Use(middleware.RealIP)
	}
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)
	r.Use(sameOriginWrites)
	// Compress text responses (JSON API + UI bundles); media types are skipped
	// so range requests and already-compressed images/videos pass through.
	r.Use(middleware.Compress(5, "application/json", "text/html", "text/css",
		"application/javascript", "text/javascript", "image/svg+xml"))
	r.Use(timeoutExcept(60*time.Second, "/api/assets/zip", "/api/export"))

	// Login throttle: ~10 attempts then 1 per 6s per IP (F-14).
	loginLimiter := newIPLimiter(rate.Every(6*time.Second), 10, 10*time.Minute)
	// Pairing-claim throttle: the endpoint is unauthenticated, so bound guesses
	// per IP even though codes carry full entropy.
	pairLimiter := newIPLimiter(rate.Every(6*time.Second), 10, 10*time.Minute)

	r.Get("/healthz", d.healthz)
	r.With(d.requireMetricsAuth).Get("/metrics", d.metrics)

	// Public app download: a new phone fetches the APK before it has any
	// credentials, so this sits outside /api and requires no session.
	r.Get("/download/android", d.downloadAndroid)

	r.Route("/api", func(r chi.Router) {
		r.Get("/status", d.status)
		r.Get("/openapi.json", d.serveOpenAPI)
		r.Get("/setup", d.setupStatus)
		r.Post("/setup", d.setup)
		r.With(loginLimiter.middleware).Post("/login", d.login)
		r.Post("/logout", d.logout)
		r.Get("/me", d.me)
		r.With(pairLimiter.middleware).Post("/devices/pair/claim", d.claimPairingCode)

		r.Group(func(r chi.Router) {
			r.Use(d.requireAuth)
			r.Post("/account/password", d.changePassword)
			r.Get("/assets", d.listAssets)
			r.Post("/devices", d.registerDevice)
			r.Post("/devices/pair", d.createPairingCode)
			r.Delete("/devices/{id}", d.revokeDevice)
			r.Get("/changes", d.changes)
			r.Get("/events", d.events)
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
			r.Get("/assets/{id}/stack", d.stackAssets)
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
			r.Post("/assets/{id}/rebuild", d.rebuildAsset)
			r.Get("/duplicates", d.duplicates)
			r.Post("/duplicates/run", d.runDuplicates)
			r.Get("/export", d.exportLibrary)
			r.Get("/integrity", d.integrity)
			r.Post("/integrity/run", d.runIntegrity)
			r.Get("/backup", d.backupStatus)
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

		r.Group(func(r chi.Router) {
			r.Use(d.requireDeviceAuth)
			r.Get("/capture/status", d.captureStatus)
			r.Get("/capture/changes", d.changes)
			r.Post("/capture/uploads", d.captureStart)
			r.Patch("/capture/uploads/{id}", d.captureAppend)
			r.Post("/capture/uploads/{id}/complete", d.captureComplete)
			// Read access for the mobile client: the same filter language and
			// media endpoints as the web UI, authenticated by the device token.
			r.Get("/capture/library", d.respondFiltered)
			r.Get("/capture/places", d.placesSummary)
			r.Get("/capture/assets/{id}", d.getAsset)
			r.Get("/capture/assets/{id}/thumb", d.serveThumb)
			r.Get("/capture/assets/{id}/preview", d.servePreview)
			r.Get("/capture/assets/{id}/original", d.serveOriginal)
			r.Post("/capture/assets/{id}/favorite", d.setFavorite)
			r.Get("/capture/memories", d.onThisDay)
			r.Get("/capture/trash", d.listTrash)
			r.Post("/capture/assets/{id}/restore", d.restoreAsset)
			r.Delete("/capture/assets/{id}", d.deleteAsset)
			r.Delete("/capture/trash/{id}", d.purgeAsset)

			r.Get("/capture/albums", d.listAlbums)
			r.Post("/capture/albums", d.createAlbum)
			r.Get("/capture/albums/{id}", d.getAlbum)
			r.Post("/capture/albums/{id}/assets", d.addAlbumAssets)
			r.Delete("/capture/albums/{id}/assets", d.removeAlbumAssets)
		})
	})

	// Everything else falls through to the embedded SPA.
	r.Handle("/*", spaHandler(uiFS()))
	return r
}

// timeoutExcept keeps bounded request handling for the API and UI while
// allowing large ZIP exports to finish. Request cancellation is still passed
// through from the client context.
func timeoutExcept(timeout time.Duration, paths ...string) func(http.Handler) http.Handler {
	exempt := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		exempt[path] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		limited := middleware.Timeout(timeout)(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := exempt[r.URL.Path]; ok {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
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

// status reports the server name and version.
// @Summary  Server status
// @Tags     system
// @Produce  json
// @Success  200 {object} map[string]string
// @Router   /api/status [get]
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
