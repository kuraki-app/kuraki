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
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/geo"
	"github.com/kuraki-app/kuraki/internal/httpapi"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/ocr"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/stacks"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/kuraki-app/kuraki/internal/trash"
	"github.com/kuraki-app/kuraki/internal/verify"

	"database/sql"
)

// App is the assembled application.
type App struct {
	Cfg     config.Config
	Log     *slog.Logger
	DB      *sql.DB
	Store   storage.Storage
	Media   media.Processor
	Queue   *queue.Queue
	Version string
}

// New assembles the application: it creates the data directories, opens the
// database in WAL mode, runs migrations (with an automatic pre-migration
// snapshot), and selects the media backend. The pure-Go processor is used by
// default; builds tagged "vips" swap in the libvips backend.
func New(ctx context.Context, cfg config.Config, version string, log *slog.Logger) (*App, error) {
	for _, dir := range []string{cfg.DataDir, cfg.OriginalsDir(), cfg.DerivativesDir(), cfg.TrashDir(), cfg.SnapshotsDir(), cfg.StagingDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("app: create %s: %w", dir, err)
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
	q, err := queue.New(database, store, proc, cfg.ThumbnailSize, cfg.StagingDir(), log)
	if err != nil {
		database.Close()
		return nil, err
	}

	return &App{
		Cfg:     cfg,
		Log:     log,
		DB:      database,
		Store:   store,
		Media:   proc,
		Queue:   q,
		Version: version,
	}, nil
}

// Import walks a source directory into the local library.
func (a *App) Import(ctx context.Context, opts importer.Options) (importer.Result, error) {
	runner := importer.Importer{
		DB:           a.DB,
		Store:        a.Store,
		Media:        a.Media,
		ThumbMaxEdge: a.Cfg.ThumbnailSize,
	}
	result, err := runner.Run(ctx, opts)
	if err == nil && result.Imported > 0 {
		if derr := stacks.Detect(ctx, a.DB); derr != nil {
			a.Log.Warn("stack detection failed", "err", derr)
		}
	}
	return result, err
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
		WHERE a.media_type = 'image' AND a.phash IS NULL AND a.deleted_at IS NULL`)
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

// startIntegrityScheduler runs an integrity verification at startup if one is
// due, then re-checks daily. The interval keeps large libraries from being
// re-scanned on every restart.
func (a *App) startIntegrityScheduler(ctx context.Context) {
	const interval = 7 * 24 * time.Hour
	due := func() bool {
		last, ok, err := verify.LastRun(ctx, a.DB)
		if err != nil || !ok || last.FinishedAt == "" {
			return true
		}
		t, err := time.Parse(time.RFC3339Nano, last.FinishedAt)
		if err != nil {
			return true
		}
		return time.Since(t) >= interval
	}
	run := func() {
		result, err := verify.RunAndRecord(ctx, a.DB, a.Store)
		if err != nil {
			a.Log.Warn("integrity verification failed", "err", err)
			return
		}
		a.Log.Info("integrity verification complete", "checked", result.Checked, "problems", len(result.Problems))
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second): // let startup settle first
		}
		if due() {
			run()
		}
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if due() {
					run()
				}
			}
		}
	}()
}

// PurgeTrash permanently removes assets whose retention window has elapsed (F-10).
func (a *App) PurgeTrash(ctx context.Context) (int, error) {
	days := a.Cfg.TrashRetentionDays
	if days <= 0 {
		days = 30
	}
	return trash.PurgeExpired(ctx, a.DB, a.Store, time.Now().AddDate(0, 0, -days))
}

// startTrashJanitor purges expired trash once at startup and daily thereafter.
func (a *App) startTrashJanitor(ctx context.Context) {
	run := func() {
		n, err := a.PurgeTrash(ctx)
		if err != nil {
			a.Log.Warn("trash purge failed", "err", err)
			return
		}
		if n > 0 {
			a.Log.Info("purged expired trash", "count", n)
		}
	}
	run()
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
}

// purgeExpiredCaptures removes capture upload sessions that were never
// completed before their expiry, along with their staging directories, so an
// abandoned mobile upload does not leak disk or database rows. Sessions that
// have already been handed to the importer (job_id set) are left alone.
func (a *App) purgeExpiredCaptures(ctx context.Context) (int, error) {
	rows, err := a.DB.QueryContext(ctx, `
		SELECT id, source_dir FROM upload_sessions
		WHERE status = 'receiving' AND expires_at < ?`, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("app: query expired captures: %w", err)
	}
	type expired struct{ id, dir string }
	var stale []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.dir); err != nil {
			rows.Close()
			return 0, fmt.Errorf("app: scan expired capture: %w", err)
		}
		stale = append(stale, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("app: iterate expired captures: %w", err)
	}
	n := 0
	for _, e := range stale {
		if err := os.RemoveAll(e.dir); err != nil {
			a.Log.Warn("capture staging cleanup failed", "session", e.id, "err", err)
			continue
		}
		if _, err := a.DB.ExecContext(ctx, `DELETE FROM upload_sessions WHERE id = ? AND status = 'receiving'`, e.id); err != nil {
			a.Log.Warn("capture session delete failed", "session", e.id, "err", err)
			continue
		}
		n++
	}
	return n, nil
}

// startCaptureJanitor removes expired, never-completed capture sessions at
// startup and hourly thereafter.
func (a *App) startCaptureJanitor(ctx context.Context) {
	run := func() {
		n, err := a.purgeExpiredCaptures(ctx)
		if err != nil {
			a.Log.Warn("capture purge failed", "err", err)
			return
		}
		if n > 0 {
			a.Log.Info("purged expired capture sessions", "count", n)
		}
		// Expired pairing codes (claimed or not) are dead weight; sweep them too.
		if _, err := a.DB.ExecContext(ctx, `DELETE FROM pairing_codes WHERE expires_at < ?`,
			time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			a.Log.Warn("pairing code purge failed", "err", err)
		}
	}
	run()
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
}

// startOCRWorker, when OCR is enabled and tesseract is present, recognises text
// in images that have not been processed yet and indexes it so a search finds
// words inside screenshots and documents. It processes small batches with a
// pause between them to stay light, and stops when the library is caught up.
func (a *App) startOCRWorker(ctx context.Context) {
	if !a.Cfg.OCREnabled {
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
		JOIN derivatives d ON d.asset_id = a.id AND d.kind = 'thumb'
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM assets_fts WHERE asset_id = ?`, id); err != nil {
		return err
	}
	takenText := ""
	if takenAt.Valid && len(takenAt.String) >= 10 {
		takenText = takenAt.String[:10]
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`,
		id, filename, camera, takenText, desc.String, text); err != nil {
		return err
	}
	return tx.Commit()
}

// Serve starts the HTTP server and blocks until ctx is cancelled, then shuts
// down gracefully.
func (a *App) Serve(ctx context.Context) error {
	a.startTrashJanitor(ctx)
	a.startCaptureJanitor(ctx)
	a.startIntegrityScheduler(ctx)
	a.startOCRWorker(ctx)
	go a.backfillPlaces(ctx)
	go a.backfillPHashes(ctx)
	go func() {
		if err := stacks.Detect(ctx, a.DB); err != nil {
			a.Log.Warn("stack detection failed", "err", err)
		}
	}()
	go a.Queue.Start(ctx)

	handler := httpapi.NewRouter(httpapi.Deps{
		Version:   a.Version,
		DB:        a.DB,
		Store:     a.Store,
		Media:     a.Media,
		Queue:     a.Queue,
		ThumbSize: a.Cfg.ThumbnailSize,
		Logger:    a.Log,
	})
	srv := &http.Server{
		Addr:              a.Cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		a.Log.Info("kuraki serving", "addr", a.Cfg.Addr, "data_dir", a.Cfg.DataDir, "version", a.Version)
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
