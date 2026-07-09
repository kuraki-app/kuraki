// Command kuraki is the single entrypoint for the Kuraki photo server.
//
//	kuraki serve     start the web server
//	kuraki import     bulk-import a directory (M1)
//	kuraki verify     re-checksum the library (M2)
//	kuraki version    print version
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/saranshhardaha/kuraki/internal/app"
	"github.com/saranshhardaha/kuraki/internal/config"
	"github.com/saranshhardaha/kuraki/internal/importer"
	"github.com/saranshhardaha/kuraki/internal/verify"

	"github.com/spf13/cobra"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := rootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "kuraki",
		Short:         "Kuraki — lightweight self-hosted photo backup",
		SilenceUsage:  true,
		SilenceErrors: false,
		Version:       version,
	}
	root.AddCommand(serveCmd(), importCmd(), verifyCmd(), versionCmd())
	return root
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

			a, err := app.New(ctx, cfg, version, log)
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
		dataDir      string
		dryRun       bool
		watch        bool
		thumbWorkers int
	)
	cmd := &cobra.Command{
		Use:   "import <dir>",
		Short: "Bulk-import a directory of photos/videos (M1)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if watch {
				return fmt.Errorf("watch import is not implemented yet")
			}

			cfg := config.Load(os.Getenv)
			if cmd.Flags().Changed("data-dir") {
				cfg.DataDir = dataDir
			}

			log := newLogger()
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			a, err := app.New(ctx, cfg, version, log)
			if err != nil {
				return err
			}
			defer a.Close()

			result, err := a.Import(ctx, importer.Options{
				SourceDir:        args[0],
				DryRun:           dryRun,
				Progress:         cmd.OutOrStdout(),
				ThumbnailWorkers: thumbWorkers,
			})
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
	cmd.Flags().BoolVar(&watch, "watch", false, "keep watching the directory for new files")
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

			a, err := app.New(ctx, cfg, version, log)
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
