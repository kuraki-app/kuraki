// Package app wires Kuraki's components together (config -> db -> storage ->
// media -> http) and owns the server lifecycle. It is the composition root; it
// is the only place allowed to know about every layer at once.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
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
	Version string
}

// New assembles the application: it creates the data directories, opens the
// database in WAL mode, runs migrations (with an automatic pre-migration
// snapshot), and selects the media backend. The pure-Go processor is used by
// default; builds tagged "vips" swap in the libvips backend.
func New(ctx context.Context, cfg config.Config, version string, log *slog.Logger) (*App, error) {
	for _, dir := range []string{cfg.DataDir, cfg.OriginalsDir(), cfg.DerivativesDir(), cfg.TrashDir(), cfg.SnapshotsDir()} {
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

	return &App{
		Cfg:     cfg,
		Log:     log,
		DB:      database,
		Store:   store,
		Media:   newProcessor(), // build-tag selected (purego by default)
		Version: version,
	}, nil
}

// Import walks a source directory into the local library.
func (a *App) Import(ctx context.Context, opts importer.Options) (importer.Result, error) {
	runner := importer.Importer{
		DB:    a.DB,
		Store: a.Store,
		Media: a.Media,
	}
	return runner.Run(ctx, opts)
}

// Verify re-checksums every original against its stored BLAKE3 hash (F-12).
func (a *App) Verify(ctx context.Context, progress func(done, total int)) (verify.Result, error) {
	v := verify.Verifier{DB: a.DB, Store: a.Store}
	return v.Run(ctx, progress)
}

// PurgeTrash permanently removes assets whose retention window has elapsed (F-10).
func (a *App) PurgeTrash(ctx context.Context) (int, error) {
	return trash.PurgeExpired(ctx, a.DB, a.Store, time.Now().Add(-trash.Retention))
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

// Serve starts the HTTP server and blocks until ctx is cancelled, then shuts
// down gracefully.
func (a *App) Serve(ctx context.Context) error {
	a.startTrashJanitor(ctx)

	handler := httpapi.NewRouter(httpapi.Deps{
		Version: a.Version,
		DB:      a.DB,
		Store:   a.Store,
		Media:   a.Media,
		Logger:  a.Log,
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
