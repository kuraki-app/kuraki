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

	"github.com/saranshh/kuraki/internal/config"
	"github.com/saranshh/kuraki/internal/db"
	"github.com/saranshh/kuraki/internal/httpapi"
	"github.com/saranshh/kuraki/internal/media"
	"github.com/saranshh/kuraki/internal/storage"

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

// Serve starts the HTTP server and blocks until ctx is cancelled, then shuts
// down gracefully.
func (a *App) Serve(ctx context.Context) error {
	handler := httpapi.NewRouter(httpapi.Deps{
		Version: a.Version,
		DB:      a.DB,
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
