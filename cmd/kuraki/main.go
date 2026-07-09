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
	cmd := &cobra.Command{
		Use:   "import <dir>",
		Short: "Bulk-import a directory of photos/videos (M1)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return fmt.Errorf("import is implemented in M1 (F-04); not yet available")
		},
	}
	cmd.Flags().Bool("dry-run", false, "scan and report without writing")
	cmd.Flags().Bool("watch", false, "keep watching the directory for new files")
	return cmd
}

func verifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "verify",
		Short: "Re-checksum the library and report mismatches (M2)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return fmt.Errorf("verify is implemented in M2 (F-12); not yet available")
		},
	}
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
