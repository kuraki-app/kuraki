package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"

	"github.com/kuraki-app/kuraki/internal/app"
	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/migrate"
	"github.com/kuraki-app/kuraki/internal/migrate/immich"

	"github.com/spf13/cobra"
)

// migrateCmd groups library migrations from other photo servers.
func migrateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Migrate a library from another photo server into Kuraki",
		Long: "Migrate a library from another photo server into Kuraki.\n\n" +
			"Migrations are resumable and safe to re-run: every item that has already\n" +
			"been transferred is recorded, so a second run imports nothing twice.",
	}
	cmd.AddCommand(migrateImmichCmd(), migrateStatusCmd())
	return cmd
}

func migrateImmichCmd() *cobra.Command {
	var (
		dataDir        string
		serverURL      string
		apiKey         string
		owner          string
		resume         string
		dryRun         bool
		batchSize      int
		parallel       int
		includeTrashed bool
		withAlbums     bool
		withTags       bool
		withStacks     bool
		takenAfter     string
	)
	cmd := &cobra.Command{
		Use:   "immich",
		Short: "Migrate a library from an Immich server",
		Long: "Migrate a library from an Immich server over its REST API.\n\n" +
			"Requires an Immich API key (Immich: Account Settings -> API Keys). The key is\n" +
			"used for this run only and is never written to the Kuraki database, so an\n" +
			"interrupted migration is resumed by re-running with --resume and the key.\n\n" +
			"The URL and key may also be supplied as KURAKI_IMMICH_URL and\n" +
			"KURAKI_IMMICH_API_KEY, which keeps the key out of your shell history.",
		Example: "  kuraki migrate immich --url https://immich.example --api-key $IMMICH_KEY\n" +
			"  kuraki migrate immich --url https://immich.example --api-key $IMMICH_KEY --dry-run\n" +
			"  kuraki migrate immich --resume 019a... --url https://immich.example --api-key $IMMICH_KEY",
		RunE: func(cmd *cobra.Command, args []string) error {
			if serverURL == "" {
				serverURL = os.Getenv("KURAKI_IMMICH_URL")
			}
			if apiKey == "" {
				apiKey = os.Getenv("KURAKI_IMMICH_API_KEY")
			}
			if serverURL == "" {
				return fmt.Errorf("--url is required (or set KURAKI_IMMICH_URL)")
			}
			if apiKey == "" {
				return fmt.Errorf("--api-key is required (or set KURAKI_IMMICH_API_KEY)")
			}

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

			src, err := immich.New(serverURL, apiKey, nil, immich.Options{
				IncludeTrashed: includeTrashed,
				IncludeAlbums:  withAlbums,
				IncludeTags:    withTags,
				IncludeStacks:  withStacks,
				TakenAfter:     takenAfter,
			})
			if err != nil {
				return err
			}
			defer src.Close()

			out := cmd.OutOrStdout()
			run, err := a.Migrate(ctx, src, migrate.Options{
				OwnerUsername: owner,
				BatchSize:     batchSize,
				Parallel:      parallel,
				DryRun:        dryRun,
				ResumeRunID:   resume,
				Progress:      out,
			})
			if run.ID != "" && !dryRun {
				fmt.Fprintln(out)
				fmt.Fprintf(out, "run=%s status=%s imported=%d duplicates=%d skipped=%d errors=%d\n",
					run.ID, run.Status, run.Imported, run.Duplicates, run.Skipped, run.Errors)
			}
			if err != nil {
				if run.ID != "" {
					fmt.Fprintf(out, "\nresume with:\n  kuraki migrate immich --resume %s --url %s --api-key <key>\n",
						run.ID, serverURL)
				}
				return err
			}
			if run.Errors > 0 {
				fmt.Fprintf(out, "\n%d item(s) failed. Re-run the same command to retry just those:\n"+
					"  kuraki migrate immich --resume %s --url %s --api-key <key>\n", run.Errors, run.ID, serverURL)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	cmd.Flags().StringVar(&serverURL, "url", "", "Immich server URL (env: KURAKI_IMMICH_URL)")
	cmd.Flags().StringVar(&apiKey, "api-key", "", "Immich API key (env: KURAKI_IMMICH_API_KEY)")
	cmd.Flags().StringVar(&owner, "owner", "owner", "Kuraki account to import into")
	cmd.Flags().StringVar(&resume, "resume", "", "resume a previous migration run by id")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "report what would be migrated without writing")
	cmd.Flags().IntVar(&batchSize, "batch", 250, "assets to download and import per batch")
	cmd.Flags().IntVar(&parallel, "parallel", 4, "concurrent downloads")
	cmd.Flags().BoolVar(&includeTrashed, "include-trashed", false, "also migrate trashed assets into Kuraki's trash")
	cmd.Flags().BoolVar(&withAlbums, "albums", true, "recreate albums and their membership")
	cmd.Flags().BoolVar(&withTags, "tags", true, "recreate tags and their hierarchy")
	cmd.Flags().BoolVar(&withStacks, "stacks", true, "preserve stacks and live-photo pairs")
	cmd.Flags().StringVar(&takenAfter, "since", "", "only migrate assets captured at or after this RFC3339 time")
	return cmd
}

func migrateStatusCmd() *cobra.Command {
	var dataDir string
	cmd := &cobra.Command{
		Use:   "status [run-id]",
		Short: "Show migration runs and their progress",
		Args:  cobra.MaximumNArgs(1),
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
			if len(args) == 1 {
				run, err := migrate.LoadRun(ctx, a.DB, args[0])
				if err != nil {
					return err
				}
				fmt.Fprintf(out, "run        %s\n", run.ID)
				fmt.Fprintf(out, "source     %s (%s)\n", run.Source, run.Endpoint)
				fmt.Fprintf(out, "status     %s\n", run.Status)
				fmt.Fprintf(out, "progress   %d/%d processed\n", run.Processed, run.Total)
				fmt.Fprintf(out, "imported   %d\n", run.Imported)
				fmt.Fprintf(out, "duplicates %d\n", run.Duplicates)
				fmt.Fprintf(out, "skipped    %d\n", run.Skipped)
				fmt.Fprintf(out, "errors     %d\n", run.Errors)
				fmt.Fprintf(out, "started    %s\n", run.StartedAt)
				if run.FinishedAt != "" {
					fmt.Fprintf(out, "finished   %s\n", run.FinishedAt)
				}
				if run.Error != "" {
					fmt.Fprintf(out, "error      %s\n", run.Error)
				}
				return nil
			}

			runs, err := migrate.ListRuns(ctx, a.DB, 20)
			if err != nil {
				return err
			}
			if len(runs) == 0 {
				fmt.Fprintln(out, "no migrations have been run")
				return nil
			}
			w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "RUN\tSOURCE\tSTATUS\tIMPORTED\tDUPES\tSKIPPED\tERRORS\tSTARTED")
			for _, r := range runs {
				fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%d\t%d\t%d\t%s\n",
					r.ID, r.Source, r.Status, r.Imported, r.Duplicates, r.Skipped, r.Errors, r.StartedAt)
			}
			return w.Flush()
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", config.Default().DataDir, "library data directory")
	return cmd
}
