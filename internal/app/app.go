// Package app wires Kuraki's components together (config -> db -> storage ->
// media -> http) and owns the server lifecycle. It is the composition root; it
// is the only place allowed to know about every layer at once.
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"strconv"

	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/duplicates"
	"github.com/kuraki-app/kuraki/internal/fts"
	"github.com/kuraki-app/kuraki/internal/geo"
	"github.com/kuraki-app/kuraki/internal/httpapi"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/maintenance"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/migrate"
	"github.com/kuraki-app/kuraki/internal/ocr"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/serversettings"
	"github.com/kuraki-app/kuraki/internal/stacks"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/kuraki-app/kuraki/internal/thumbs"
	"github.com/kuraki-app/kuraki/internal/verify"

	"database/sql"
)

// App is the assembled application.
type App struct {
	// Settings holds the live, resolved configuration. TrashRetentionDays and
	// ChangeLogKeep are read fresh from it on every worker pass (Settings.
	// Current()); everything else is read once from Settings.Booted() because
	// it is baked into a constructor (queue.New, httpapi.Deps) at Serve()
	// time and never re-read — see internal/config.Store's doc comment.
	Settings    *config.Store
	Log         *slog.Logger
	DB          *sql.DB
	Store       storage.Storage
	Media       media.Processor
	Queue       *queue.Queue
	Maintenance *maintenance.Manager
	Version     string
}

// New assembles the application: it creates the data directories, opens the
// database in WAL mode, runs migrations (with an automatic pre-migration
// snapshot), and selects the media backend. The pure-Go processor is used by
// default; builds tagged "vips" swap in the libvips backend.
func New(ctx context.Context, cfg config.Config, getenv func(string) string, version string, log *slog.Logger) (*App, error) {
	for _, dir := range []string{cfg.DataDir, cfg.OriginalsDir(), cfg.DerivativesDir(), cfg.TrashDir(), cfg.SnapshotsDir(), cfg.StagingDir(), cfg.DownloadsDir()} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("app: create %s: %w", dir, err)
		}
		if err := os.Chmod(dir, 0o750); err != nil {
			return nil, fmt.Errorf("app: secure %s: %w", dir, err)
		}
	}

	database, err := db.Open(ctx, cfg.DBPath())
	if err != nil {
		return nil, err
	}

	snapshot := func() error {
		path, err := db.Snapshot(ctx, database, cfg.SnapshotsDir())
		if err == nil {
			log.Info("pre-migration snapshot written", "path", path)
		}
		return err
	}
	if err := db.Migrate(database, snapshot); err != nil {
		database.Close()
		return nil, err
	}

	store, err := storage.NewFS(cfg.DataDir)
	if err != nil {
		database.Close()
		return nil, err
	}

	proc := newProcessor() // build-tag selected (purego by default)
	settingRows, err := serversettings.LoadAll(ctx, database)
	if err != nil {
		database.Close()
		return nil, err
	}
	settings := config.NewStore(cfg, config.EnvPresent(getenv), settingRows)
	booted := settings.Booted()

	q, err := queue.New(database, store, proc, booted.ThumbnailSize, booted.StagingDir(), log)
	if err != nil {
		database.Close()
		return nil, err
	}

	duplicates.Start(ctx, database, log)
	maint := maintenance.New(database, store, settings, log)
	return &App{
		Settings:    settings,
		Log:         log,
		DB:          database,
		Store:       store,
		Media:       proc,
		Queue:       q,
		Maintenance: maint,
		Version:     version,
	}, nil
}

// Import walks a source directory into the local library.
func (a *App) Import(ctx context.Context, opts importer.Options) (importer.Result, error) {
	runner := importer.Importer{
		DB:           a.DB,
		Store:        a.Store,
		Media:        a.Media,
		ThumbMaxEdge: a.Settings.Booted().ThumbnailSize,
	}
	result, err := runner.Run(ctx, opts)
	if err == nil && result.Imported > 0 {
		if derr := stacks.Detect(ctx, a.DB); derr != nil {
			a.Log.Warn("stack detection failed", "err", derr)
		}
	}
	return result, err
}

// Migrate imports another photo server's library, preserving the metadata that
// does not live in the media bytes. It opens a jobs row so the Activity view
// tracks progress, then hands off to the source-agnostic engine.
func (a *App) Migrate(ctx context.Context, src migrate.Source, opts migrate.Options) (migrate.Run, error) {
	booted := a.Settings.Booted()
	engine := &migrate.Engine{
		DB:         a.DB,
		Store:      a.Store,
		Media:      a.Media,
		Log:        a.Log,
		ThumbSize:  booted.ThumbnailSize,
		StagingDir: booted.StagingDir(),
		Opts:       opts,
	}

	// A dry run writes nothing, so it gets no job row either.
	var jobID string
	if !opts.DryRun {
		owner := opts.OwnerUsername
		if owner == "" {
			owner = "owner"
		}
		id, err := a.Queue.TrackMigration(ctx, owner, "pending", 0)
		if err != nil {
			a.Log.Warn("migration job tracking unavailable", "err", err)
		} else {
			jobID = id
			engine.JobID = id
		}
	}

	run, runErr := engine.Run(ctx, src)

	if jobID != "" {
		// Point the job at the real run id now that it exists, so the crash
		// recovery hint names something resumable.
		if run.ID != "" {
			_, _ = a.DB.ExecContext(ctx, `UPDATE jobs SET source = ? WHERE id = ?`, run.ID, jobID)
		}
		status, message := "succeeded", ""
		if runErr != nil {
			status, message = "failed", runErr.Error()
		}
		if err := a.Queue.FinishMigration(ctx, jobID, status, message); err != nil {
			a.Log.Warn("finalize migration job failed", "err", err)
		}
	}

	// Migrated assets can form stacks by filename the source never declared
	// (RAW+JPEG pairs), the same as any bulk import.
	if runErr == nil && run.Imported > 0 {
		if derr := stacks.Detect(ctx, a.DB); derr != nil {
			a.Log.Warn("stack detection failed", "err", derr)
		}
	}
	return run, runErr
}

// Verify re-checksums every original against its stored BLAKE3 hash (F-12).
func (a *App) Verify(ctx context.Context, progress func(done, total int)) (verify.Result, error) {
	v := verify.Verifier{DB: a.DB, Store: a.Store}
	return v.Run(ctx, progress)
}

// backfillPlaces resolves place names for assets that carry GPS but were imported
// before reverse geocoding existed. Runs once in the background at startup.
func (a *App) backfillPlaces(ctx context.Context) {
	rows, err := a.DB.QueryContext(ctx,
		`SELECT id, gps_lat, gps_lon FROM assets
		 WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL AND place_city IS NULL`)
	if err != nil {
		a.Log.Warn("place backfill query failed", "err", err)
		return
	}
	type target struct {
		id       string
		lat, lon float64
	}
	var todo []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.lat, &t.lon); err != nil {
			rows.Close()
			return
		}
		todo = append(todo, t)
	}
	rows.Close()
	if len(todo) == 0 {
		return
	}

	updated := 0
	for _, t := range todo {
		select {
		case <-ctx.Done():
			return
		default:
		}
		city, country := "", ""
		if p, ok := geo.Reverse(t.lat, t.lon); ok {
			city, country = p.City, p.Country
		}
		// Store empty strings for unresolved coordinates so they are not retried.
		if _, err := a.DB.ExecContext(ctx,
			`UPDATE assets SET place_city = ?, place_country = ? WHERE id = ?`,
			city, country, t.id); err == nil {
			updated++
		}
	}
	if updated > 0 {
		a.Log.Info("backfilled place names", "count", updated)
	}
}

// backfillPHashes computes perceptual hashes for images imported before duplicate
// review existed, reading each asset's thumbnail. Runs once in the background.
func (a *App) backfillPHashes(ctx context.Context) {
	rows, err := a.DB.QueryContext(ctx, `
		SELECT a.id, d.path FROM assets a
		JOIN derivatives d ON d.asset_id = a.id AND d.kind = 'thumb'
		WHERE a.media_type IN ('image','video') AND a.phash IS NULL AND a.deleted_at IS NULL`)
	if err != nil {
		a.Log.Warn("phash backfill query failed", "err", err)
		return
	}
	type item struct{ id, thumb string }
	var todo []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.thumb); err != nil {
			rows.Close()
			return
		}
		todo = append(todo, it)
	}
	rows.Close()
	if len(todo) == 0 {
		return
	}

	updated := 0
	for _, it := range todo {
		select {
		case <-ctx.Done():
			return
		default:
		}
		rc, err := a.Store.Open(ctx, "derivatives/"+it.thumb)
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(rc)
		rc.Close()
		if h, ok := media.PerceptualHash(data); ok {
			if _, err := a.DB.ExecContext(ctx, `UPDATE assets SET phash = ? WHERE id = ?`, int64(h), it.id); err == nil {
				updated++
			}
		}
	}
	if updated > 0 {
		a.Log.Info("backfilled perceptual hashes", "count", updated)
	}
}

// startOCRWorker, when OCR is enabled and tesseract is present, recognises text
// in images that have not been processed yet and indexes it so a search finds
// words inside screenshots and documents. It processes small batches with a
// pause between them to stay light, and stops when the library is caught up.
func (a *App) startOCRWorker(ctx context.Context) {
	if !a.Settings.Booted().OCREnabled {
		return
	}
	if !ocr.Available() {
		a.Log.Warn("OCR requested but tesseract not found on PATH; skipping")
		return
	}
	go func() {
		a.Log.Info("OCR worker started")
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			n, err := a.ocrBatch(ctx, 20)
			if err != nil {
				a.Log.Warn("OCR batch failed", "err", err)
			}
			if n == 0 {
				// Caught up; check again in a while for newly imported images.
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Minute):
				}
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()
}

// ocrBatch processes up to limit unprocessed images and returns how many it
// handled. An image with no text still gets an empty marker so it is not retried.
func (a *App) ocrBatch(ctx context.Context, limit int) (int, error) {
	rows, err := a.DB.QueryContext(ctx, `
		SELECT a.id, d.path FROM assets a
		JOIN derivatives d ON d.asset_id = a.id AND d.kind IN ('thumb','poster')
		WHERE a.media_type = 'image' AND a.deleted_at IS NULL AND a.ocr_text IS NULL
		LIMIT ?`, limit)
	if err != nil {
		return 0, fmt.Errorf("app: query ocr candidates: %w", err)
	}
	type candidate struct{ id, path string }
	var todo []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.path); err != nil {
			rows.Close()
			return 0, err
		}
		todo = append(todo, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, c := range todo {
		text := a.recognizeDerivative(ctx, c.path)
		if err := a.storeOCR(ctx, c.id, text); err != nil {
			a.Log.Warn("OCR store failed", "asset", c.id, "err", err)
		}
	}
	return len(todo), nil
}

func (a *App) recognizeDerivative(ctx context.Context, relPath string) string {
	f, err := a.Store.Open(ctx, "derivatives/"+relPath)
	if err != nil {
		a.Log.Warn("OCR read derivative failed", "path", relPath, "err", err)
		return ""
	}
	data, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		return ""
	}
	text, err := ocr.RecognizeBytes(ctx, data, filepath.Ext(relPath))
	if err != nil {
		a.Log.Warn("OCR recognize failed", "path", relPath, "err", err)
		return ""
	}
	return text
}

// storeOCR saves the recognised text (possibly empty, marking the image done)
// and refreshes the asset's full-text index row.
func (a *App) storeOCR(ctx context.Context, id, text string) error {
	tx, err := a.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE assets SET ocr_text = ? WHERE id = ?`, text, id); err != nil {
		return err
	}
	var filename, camera string
	var takenAt, desc sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT filename, camera_model, taken_at, description FROM assets WHERE id = ?`, id).
		Scan(&filename, &camera, &takenAt, &desc); err != nil {
		return err
	}
	takenText := ""
	if takenAt.Valid && len(takenAt.String) >= 10 {
		takenText = takenAt.String[:10]
	}
	if err := fts.Replace(ctx, tx, fts.Row{
		AssetID: id, Filename: filename, CameraModel: camera,
		TakenText: takenText, Description: desc.String, OCRText: text,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// Serve starts the HTTP server and blocks until ctx is cancelled, then shuts
// down gracefully.
func (a *App) Serve(ctx context.Context) error {
	a.Maintenance.Start(ctx)
	a.startOCRWorker(ctx)
	go a.backfillPlaces(ctx)
	go a.backfillPHashes(ctx)
	go func() {
		if err := stacks.Detect(ctx, a.DB); err != nil {
			a.Log.Warn("stack detection failed", "err", err)
		}
	}()
	go a.Queue.Start(ctx)

	// Change broker: one poller fans change_log advances out to SSE subscribers
	// (GET /api/events), so connected web clients get near-real-time updates
	// instead of waiting on their poll interval. 1s cadence trades a cheap
	// indexed MAX query for sub-second push latency.
	events := httpapi.NewChangeBroker(a.DB, a.Log)
	go events.Poll(ctx, time.Second)

	booted := a.Settings.Booted()
	handler := httpapi.NewRouter(httpapi.Deps{
		Version:   a.Version,
		DB:        a.DB,
		Store:     a.Store,
		Media:     a.Media,
		Queue:     a.Queue,
		Settings:  a.Settings,
		ThumbSize: booted.ThumbnailSize,
		Thumbs: &thumbs.Service{
			DB: a.DB, Store: a.Store, Media: a.Media, Log: a.Log,
			MediumEdge: booted.ThumbnailSize, Workers: booted.ThumbWorkers, MaxQueue: booted.ThumbQueue,
		},
		// The port half of the configured listen address, so the pairing screen
		// can offer a URL a phone can actually route to rather than whatever the
		// browser happened to be typed with.
		ListenPort: listenPort(booted.Addr),
		// Stated by the operator when interface detection cannot be right —
		// in a container, or behind a reverse proxy.
		PublicURL:      booted.PublicURL,
		SecureCookies:  booted.SecureCookies,
		TrustProxy:     booted.TrustProxy,
		MetricsToken:   booted.MetricsToken,
		BackupEnabled:  booted.BackupDir != "",
		AndroidAPKPath: booted.AndroidAPKPath(),
		Events:         events,
		Logger:         a.Log,
	})
	srv := &http.Server{
		Addr:              booted.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	errCh := make(chan error, 1)
	go func() {
		a.Log.Info("kuraki serving", "addr", booted.Addr, "data_dir", booted.DataDir, "version", a.Version)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		a.Log.Info("shutting down")
		return srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// Close releases resources held by the app.
func (a *App) Close() error {
	if a.DB != nil {
		return a.DB.Close()
	}
	return nil
}

// listenPort extracts the port from a listen address like ":39170" or
// "127.0.0.1:39170", defaulting to the shipped port when it cannot be parsed.
func listenPort(addr string) string {
	if _, port, err := net.SplitHostPort(addr); err == nil && port != "" {
		return port
	}
	return strconv.Itoa(config.DefaultServerPort)
}
