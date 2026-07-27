// Command kuraki is the single entrypoint for the Kuraki photo server.
//
//	kuraki serve      start the web server
//	kuraki import     bulk-import a directory (M1)
//	kuraki migrate    migrate a library from another photo server
//	kuraki verify     re-checksum the library (M2)
//	kuraki version    print version
package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/kuraki-app/kuraki/internal/app"
	"github.com/kuraki-app/kuraki/internal/auth"
	"github.com/kuraki-app/kuraki/internal/backup"
	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/verify"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

// @title       Kuraki API
// @version     1.0
// @description Self-hosted photo & video backup server API. Session-cookie routes under /api and device-token routes under /api/capture.
// @BasePath    /
func main() {
	if err := rootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "kuraki",
		Short:         "Kuraki — self-hosted photo backup & sync",
		SilenceUsage:  true,
		SilenceErrors: false,
		Version:       version,
	}
	root.AddCommand(serveCmd(), importCmd(), migrateCmd(), verifyCmd(), backupCmd(), restoreCmd(), passwdCmd(), healthcheckCmd(), versionCmd())
	return root
}

// passwdCmd resets an account password offline, directly against the library
// database — the recovery path when the owner is locked out of the web UI. It
// reads the new password from an interactive terminal (no echo) or from stdin
// when piped, so it works both by hand and in scripts/containers. Every existing
// session for the account is invalidated so a forgotten-password reset also cuts
// off any sessions an attacker might hold.
func passwdCmd() *cobra.Command {
	var dataDir, username string
	cmd := &cobra.Command{
		Use:   "passwd",
		Short: "Reset an account password directly against the library (offline recovery)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Load(os.Getenv)
			if cmd.Flags().Changed("data-dir") {
				cfg.DataDir = dataDir
			}

			password, err := readNewPassword(cmd)
			if err != nil {
				return err
			}
			if len(password) < 8 {
				return fmt.Errorf("password must be at least 8 characters")
			}
			hash, err := auth.HashPassword(password)
			if err != nil {
				return err
			}

			database, err := db.Open(cmd.Context(), cfg.DBPath())
			if err != nil {
				return err
			}
			defer database.Close()

			res, err := database.ExecContext(cmd.Context(),
				`UPDATE users SET password_hash = ? WHERE username = ?`, hash, username)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return fmt.Errorf("no account named %q; set --username to match the owner", username)
			}
			// Cut every existing session so the reset also revokes stolen cookies.
			if _, err := database.ExecContext(cmd.Context(),
				`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)`, username); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "password updated for %q; all existing sessions were signed out\n", username)
			return nil
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	cmd.Flags().StringVar(&username, "username", "owner", "account username to reset")
	return cmd
}

// readNewPassword reads a new password without echo from an interactive
// terminal (asking twice to catch typos), or a single line from stdin when the
// input is piped — e.g. `echo newpass | kuraki passwd`.
func readNewPassword(cmd *cobra.Command) (string, error) {
	if f, ok := cmd.InOrStdin().(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		fmt.Fprint(cmd.OutOrStdout(), "New password: ")
		first, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(cmd.OutOrStdout())
		if err != nil {
			return "", err
		}
		fmt.Fprint(cmd.OutOrStdout(), "Confirm password: ")
		second, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(cmd.OutOrStdout())
		if err != nil {
			return "", err
		}
		if string(first) != string(second) {
			return "", fmt.Errorf("passwords did not match")
		}
		return string(first), nil
	}
	line, err := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func backupCmd() *cobra.Command {
	var dataDir string
	cmd := &cobra.Command{Use: "backup <archive.tar.gz>", Short: "Create a portable library backup", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		cfg := config.Load(os.Getenv)
		if cmd.Flags().Changed("data-dir") {
			cfg.DataDir = dataDir
		}
		database, err := db.Open(cmd.Context(), cfg.DBPath())
		if err != nil {
			return err
		}
		defer database.Close()
		return backup.CreateLive(cmd.Context(), database, cfg.DataDir, args[0])
	}}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	return cmd
}

func restoreCmd() *cobra.Command {
	var dataDir string
	cmd := &cobra.Command{Use: "restore <archive.tar.gz>", Short: "Restore a backup into an empty library data directory", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		cfg := config.Load(os.Getenv)
		if cmd.Flags().Changed("data-dir") {
			cfg.DataDir = dataDir
		}
		return backup.Restore(cmd.Context(), args[0], cfg.DataDir)
	}}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "empty target library data directory")
	return cmd
}

// healthcheckCmd probes the local server's /healthz and exits non-zero if
// unhealthy. It uses the kuraki binary itself, so a container HEALTHCHECK needs
// no extra tools (curl/wget) installed in the image.
func healthcheckCmd() *cobra.Command {
	var addr string
	cmd := &cobra.Command{
		Use:    "healthcheck",
		Short:  "Probe the local server's /healthz (for container HEALTHCHECK)",
		Hidden: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Load(os.Getenv)
			if cmd.Flags().Changed("addr") {
				cfg.Addr = addr
			}
			hostport := cfg.Addr
			if strings.HasPrefix(hostport, ":") {
				hostport = "127.0.0.1" + hostport
			}
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get("http://" + hostport + "/healthz")
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("unhealthy: status %d", resp.StatusCode)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&addr, "addr", config.Default().Addr, "server address to probe")
	return cmd
}

// newLogger builds a structured slog logger (F: clear structured logs).
func newLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func serveCmd() *cobra.Command {
	var (
		dataDir string
		addr    string
	)
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the Kuraki web server",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Load(os.Getenv)
			// Flags override environment/defaults.
			if cmd.Flags().Changed("data-dir") {
				cfg.DataDir = dataDir
			}
			if cmd.Flags().Changed("addr") {
				cfg.Addr = addr
			}

			log := newLogger()
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			a, err := app.New(ctx, cfg, os.Getenv, version, log)
			if err != nil {
				return err
			}
			defer a.Close()

			return a.Serve(ctx)
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	cmd.Flags().StringVar(&addr, "addr", config.Default().Addr, "HTTP listen address")
	return cmd
}

func importCmd() *cobra.Command {
	var (
		dataDir       string
		dryRun        bool
		watch         bool
		watchInterval time.Duration
		thumbWorkers  int
	)
	cmd := &cobra.Command{
		Use:   "import <dir>",
		Short: "Bulk-import a directory of photos/videos",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Load(os.Getenv)
			if cmd.Flags().Changed("data-dir") {
				cfg.DataDir = dataDir
			}

			log := newLogger()
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			a, err := app.New(ctx, cfg, os.Getenv, version, log)
			if err != nil {
				return err
			}
			defer a.Close()

			opts := importer.Options{
				SourceDir:        args[0],
				DryRun:           dryRun,
				Progress:         cmd.OutOrStdout(),
				ThumbnailWorkers: thumbWorkers,
			}

			// Watch mode: rescan on an interval and auto-import new files (F-20).
			// The importer's import_state skip makes each rescan cheap, so this
			// pairs cleanly with folder-sync tools like Syncthing.
			if watch {
				opts.Progress = nil
				log.Info("watching for new media", "dir", opts.SourceDir, "interval", watchInterval.String())
				ticker := time.NewTicker(watchInterval)
				defer ticker.Stop()
				for {
					result, err := a.Import(ctx, opts)
					if err != nil {
						if ctx.Err() != nil {
							return nil
						}
						log.Error("watch import pass failed", "err", err)
					} else if result.Imported > 0 || len(result.Errors) > 0 {
						log.Info("watch import", "imported", result.Imported,
							"duplicates", result.Duplicates, "errors", len(result.Errors))
					}
					select {
					case <-ctx.Done():
						return nil
					case <-ticker.C:
					}
				}
			}

			result, err := a.Import(ctx, opts)
			if err != nil {
				return err
			}
			for _, fileErr := range result.Errors {
				log.Error("import file failed", "path", fileErr.Path, "err", fileErr.Err)
			}
			fmt.Fprintf(cmd.OutOrStdout(),
				"scanned=%d imported=%d skipped=%d duplicates=%d errors=%d bytes=%d\n",
				result.Scanned, result.Imported, result.Skipped, result.Duplicates, len(result.Errors), result.Bytes)
			return nil
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "scan and report without writing")
	cmd.Flags().BoolVar(&watch, "watch", false, "keep watching the directory and auto-import new files")
	cmd.Flags().DurationVar(&watchInterval, "watch-interval", 15*time.Second, "rescan interval in --watch mode")
	cmd.Flags().IntVar(&thumbWorkers, "thumb-workers", 0, "thumbnail/poster workers (default: min(GOMAXPROCS, 2))")
	return cmd
}

func verifyCmd() *cobra.Command {
	var dataDir string
	cmd := &cobra.Command{
		Use:   "verify",
		Short: "Re-checksum the library and report mismatches",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Load(os.Getenv)
			if cmd.Flags().Changed("data-dir") {
				cfg.DataDir = dataDir
			}

			log := newLogger()
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			a, err := app.New(ctx, cfg, os.Getenv, version, log)
			if err != nil {
				return err
			}
			defer a.Close()

			out := cmd.OutOrStdout()
			result, err := a.Verify(ctx, nil)
			if err != nil {
				return err
			}
			for _, p := range result.Problems {
				switch p.Status {
				case verify.StatusMismatch:
					fmt.Fprintf(out, "MISMATCH %s (%s)\n  expected %s\n  actual   %s\n", p.Filename, p.Path, p.Expected, p.Actual)
				case verify.StatusMissing:
					fmt.Fprintf(out, "MISSING  %s (%s)\n", p.Filename, p.Path)
				default:
					fmt.Fprintf(out, "ERROR    %s (%s): %s\n", p.Filename, p.Path, p.Err)
				}
			}
			fmt.Fprintf(out, "checked=%d ok=%d problems=%d\n", result.Checked, result.OK, len(result.Problems))
			if !result.Healthy() {
				return fmt.Errorf("verify found %d problem(s)", len(result.Problems))
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	return cmd
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the Kuraki version",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintln(cmd.OutOrStdout(), "kuraki "+version)
		},
	}
}
