package migrate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/domain"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

const (
	defaultOwnerUsername = "owner"
	defaultBatchSize     = 250
	defaultParallel      = 4
)

// Engine migrates a Source into the local library.
//
// It works in batches: download a page of originals into staging, hand the
// whole batch to the importer, wire up albums/tags/stacks/trash for what landed,
// then delete the staged bytes and checkpoint. That bounds disk use to one batch
// regardless of library size, and makes an interrupted run resumable without
// re-downloading anything.
type Engine struct {
	DB         *sql.DB
	Store      storage.Storage
	Media      media.Processor
	Log        *slog.Logger
	ThumbSize  int
	StagingDir string

	// JobID, when set, mirrors progress into that jobs row so the Activity UI
	// can show a live count.
	JobID string

	Opts Options
}

// Options controls one migration run.
type Options struct {
	OwnerUsername string
	BatchSize     int
	Parallel      int
	DryRun        bool
	// ResumeRunID continues an existing run instead of starting a new one.
	ResumeRunID string
	Progress    io.Writer
}

func (o Options) batchSize() int {
	if o.BatchSize > 0 {
		return o.BatchSize
	}
	return defaultBatchSize
}

func (o Options) parallel() int {
	if o.Parallel <= 0 {
		return defaultParallel
	}
	if o.Parallel > 16 {
		return 16
	}
	return o.Parallel
}

// Run migrates everything the source offers. It returns the final run record
// even when it also returns an error, so callers can report partial progress.
func (e *Engine) Run(ctx context.Context, src Source) (Run, error) {
	if e.DB == nil || e.Store == nil || e.Media == nil {
		return Run{}, fmt.Errorf("migrate: engine is missing dependencies")
	}
	if e.Log == nil {
		e.Log = slog.Default()
	}

	info, err := src.Probe(ctx)
	if err != nil {
		return Run{}, fmt.Errorf("migrate: probe %s: %w", src.Name(), err)
	}

	username := e.Opts.OwnerUsername
	if username == "" {
		username = defaultOwnerUsername
	}
	ownerID, err := e.ensureOwner(ctx, username)
	if err != nil {
		return Run{}, err
	}

	run, err := e.startOrResume(ctx, src, ownerID, info)
	if err != nil {
		return Run{}, err
	}
	e.Log.Info("migration started", "run", run.ID, "source", src.Name(),
		"server", info.Version, "endpoint", info.Endpoint, "total", info.TotalAssets)

	if e.Opts.DryRun {
		return e.dryRun(ctx, src, run)
	}

	albums, tags, err := e.prepareContainers(ctx, src, ownerID, run.ID)
	if err != nil {
		finishRun(ctx, e.DB, run, RunFailed, err.Error())
		return run, err
	}

	if err := e.walk(ctx, src, ownerID, &run, albums, tags); err != nil {
		finishRun(ctx, e.DB, run, RunFailed, err.Error())
		return run, err
	}

	// Stacks are resolved once at the end: members are written with a
	// source-derived placeholder as they land, and only here — when every
	// member that is going to arrive has arrived — can the placeholder be
	// rewritten to the primary's real asset id.
	if err := e.finalizeStacks(ctx, ownerID); err != nil {
		e.Log.Warn("migration: finalize stacks failed", "run", run.ID, "err", err)
	}

	finishRun(ctx, e.DB, run, RunSucceeded, "")
	run.Status = RunSucceeded
	e.Log.Info("migration finished", "run", run.ID, "imported", run.Imported,
		"duplicates", run.Duplicates, "skipped", run.Skipped, "errors", run.Errors)
	return run, nil
}

func (e *Engine) startOrResume(ctx context.Context, src Source, ownerID string, info Info) (Run, error) {
	if e.Opts.ResumeRunID != "" {
		run, err := LoadRun(ctx, e.DB, e.Opts.ResumeRunID)
		if err != nil {
			return Run{}, err
		}
		if run.Source != src.Name() {
			return Run{}, fmt.Errorf("migrate: run %s is a %q migration, not %q",
				run.ID, run.Source, src.Name())
		}
		if run.Status == RunSucceeded {
			return Run{}, fmt.Errorf("migrate: run %s already succeeded", run.ID)
		}
		run.Status = RunRunning
		run.Error = ""
		if info.TotalAssets > 0 {
			run.Total = info.TotalAssets
		}
		_, _ = e.DB.ExecContext(ctx,
			`UPDATE migration_runs SET status = ?, error = '', updated_at = ? WHERE id = ?`,
			RunRunning, nowText(), run.ID)
		return run, nil
	}

	id, err := uuid.NewV7()
	if err != nil {
		return Run{}, fmt.Errorf("migrate: new run id: %w", err)
	}
	run := Run{
		ID:       id.String(),
		Source:   src.Name(),
		OwnerID:  ownerID,
		Endpoint: info.Endpoint,
		Status:   RunRunning,
		Total:    info.TotalAssets,
	}
	if err := insertRun(ctx, e.DB, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

// dryRun reports what a real run would do without writing anything.
func (e *Engine) dryRun(ctx context.Context, src Source, run Run) (Run, error) {
	albums, err := src.Albums(ctx)
	if err != nil {
		return run, err
	}
	tags, err := src.Tags(ctx)
	if err != nil {
		return run, err
	}

	cursor := ""
	for {
		page, err := src.Assets(ctx, cursor)
		if err != nil {
			return run, err
		}
		for _, item := range page.Items {
			run.Processed++
			if item.Skip {
				run.Skipped++
				continue
			}
			run.Imported++
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}

	if e.Opts.Progress != nil {
		fmt.Fprintf(e.Opts.Progress,
			"dry run: %d asset(s) would be migrated, %d skipped, %d album(s), %d tag(s)\n",
			run.Imported, run.Skipped, len(albums), len(tags))
	}
	// A dry run leaves no trace beyond the run row it reports under.
	finishRun(ctx, e.DB, run, RunCanceled, "dry run")
	return run, nil
}

// prepareContainers creates local albums and tags for every source container,
// before any asset lands, so membership can be wired up batch by batch.
func (e *Engine) prepareContainers(ctx context.Context, src Source, ownerID, runID string) (map[string]string, map[string]string, error) {
	albums, err := src.Albums(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("migrate: list albums: %w", err)
	}
	tags, err := src.Tags(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("migrate: list tags: %w", err)
	}

	albumMap, err := e.ensureAlbums(ctx, src.Name(), ownerID, runID, albums)
	if err != nil {
		return nil, nil, err
	}
	tagMap, err := e.ensureTags(ctx, src.Name(), ownerID, runID, tags)
	if err != nil {
		return nil, nil, err
	}
	return albumMap, tagMap, nil
}

func (e *Engine) ensureAlbums(ctx context.Context, source, ownerID, runID string, albums []Album) (map[string]string, error) {
	existing, err := loadMap(ctx, e.DB, ownerID, source, KindAlbum)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(albums))
	for _, a := range albums {
		if prev, ok := existing[a.SourceID]; ok && prev.LocalID != "" {
			out[a.SourceID] = prev.LocalID
			continue
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, fmt.Errorf("migrate: new album id: %w", err)
		}
		name := a.Name
		if name == "" {
			name = "Untitled album"
		}
		if _, err := e.DB.ExecContext(ctx,
			`INSERT INTO albums (id, owner_id, name, description) VALUES (?, ?, ?, ?)`,
			id.String(), ownerID, name, a.Description); err != nil {
			return nil, fmt.Errorf("migrate: create album %q: %w", name, err)
		}
		if err := recordMapping(ctx, e.DB, ownerID, source, KindAlbum, a.SourceID,
			id.String(), StatusDone, "", runID); err != nil {
			return nil, err
		}
		out[a.SourceID] = id.String()
	}
	return out, nil
}

// ensureTags creates tags parents-first so a child can reference its parent.
func (e *Engine) ensureTags(ctx context.Context, source, ownerID, runID string, tags []Tag) (map[string]string, error) {
	existing, err := loadMap(ctx, e.DB, ownerID, source, KindTag)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(tags))
	for _, t := range tags {
		if prev, ok := existing[t.SourceID]; ok && prev.LocalID != "" {
			out[t.SourceID] = prev.LocalID
		}
	}

	for _, t := range orderTagsParentsFirst(tags) {
		if _, ok := out[t.SourceID]; ok {
			continue
		}
		name := t.Name
		if name == "" {
			continue
		}
		var parent any
		if t.ParentSourceID != "" {
			if localParent, ok := out[t.ParentSourceID]; ok {
				parent = localParent
			}
		}

		// tags has UNIQUE(owner_id, name): a tag of this name may already exist
		// from a previous run or from native use. Adopt it rather than failing.
		var localID string
		err := e.DB.QueryRowContext(ctx,
			`SELECT id FROM tags WHERE owner_id = ? AND name = ?`, ownerID, name).Scan(&localID)
		if errors.Is(err, sql.ErrNoRows) {
			id, err := uuid.NewV7()
			if err != nil {
				return nil, fmt.Errorf("migrate: new tag id: %w", err)
			}
			localID = id.String()
			if _, err := e.DB.ExecContext(ctx,
				`INSERT INTO tags (id, owner_id, name, parent_id) VALUES (?, ?, ?, ?)`,
				localID, ownerID, name, parent); err != nil {
				return nil, fmt.Errorf("migrate: create tag %q: %w", name, err)
			}
		} else if err != nil {
			return nil, fmt.Errorf("migrate: lookup tag %q: %w", name, err)
		}

		if err := recordMapping(ctx, e.DB, ownerID, source, KindTag, t.SourceID,
			localID, StatusDone, "", runID); err != nil {
			return nil, err
		}
		out[t.SourceID] = localID
	}
	return out, nil
}

// orderTagsParentsFirst topologically orders tags so a parent is always created
// before its children. Cycles and dangling parents fall through to the end and
// are created as roots rather than dropped.
func orderTagsParentsFirst(tags []Tag) []Tag {
	byID := make(map[string]Tag, len(tags))
	for _, t := range tags {
		byID[t.SourceID] = t
	}
	placed := make(map[string]bool, len(tags))
	out := make([]Tag, 0, len(tags))

	var place func(t Tag, depth int)
	place = func(t Tag, depth int) {
		if placed[t.SourceID] || depth > 32 {
			return
		}
		if parent, ok := byID[t.ParentSourceID]; ok && !placed[parent.SourceID] {
			place(parent, depth+1)
		}
		if placed[t.SourceID] {
			return
		}
		placed[t.SourceID] = true
		out = append(out, t)
	}
	for _, t := range tags {
		place(t, 0)
	}
	return out
}

// walk pages through the source, importing one batch at a time.
func (e *Engine) walk(ctx context.Context, src Source, ownerID string, run *Run, albums, tags map[string]string) error {
	done, err := loadMap(ctx, e.DB, ownerID, src.Name(), KindAsset)
	if err != nil {
		return err
	}

	cursor := run.Cursor
	batchSize := e.Opts.batchSize()

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		page, err := src.Assets(ctx, cursor)
		if err != nil {
			return fmt.Errorf("migrate: list assets: %w", err)
		}

		work := make([]Item, 0, len(page.Items))
		for _, item := range page.Items {
			if prev, ok := done[item.SourceID]; ok && prev.done() {
				continue
			}
			if item.Skip {
				run.Processed++
				run.Skipped++
				_ = recordMapping(ctx, e.DB, ownerID, src.Name(), KindAsset,
					item.SourceID, "", StatusSkipped, item.SkipReason, run.ID)
				continue
			}
			work = append(work, item)
		}

		for len(work) > 0 {
			size := min(batchSize, len(work))
			if err := e.processBatch(ctx, src, ownerID, run, work[:size], albums, tags); err != nil {
				return err
			}
			work = work[size:]
			e.saveProgress(ctx, run)
		}

		if page.NextCursor == "" {
			break
		}
		// The cursor advances only once the whole page has been imported, so a
		// resume re-walks at worst one page rather than skipping items that were
		// still buffered when the run stopped. Re-walking is cheap: the
		// migration_map check above filters out everything already done.
		cursor = page.NextCursor
		run.Cursor = cursor
		e.saveProgress(ctx, run)
	}
	return nil
}

// processBatch downloads, imports, and wires up one batch.
func (e *Engine) processBatch(ctx context.Context, src Source, ownerID string, run *Run, items []Item, albums, tags map[string]string) error {
	batchDir, err := os.MkdirTemp(e.StagingDir, "migrate-"+run.ID+"-")
	if err != nil {
		return fmt.Errorf("migrate: create batch dir: %w", err)
	}
	defer os.RemoveAll(batchDir)

	staged, err := e.downloadBatch(ctx, src, ownerID, run, items, batchDir)
	if err != nil {
		return err
	}
	if len(staged) == 0 {
		return nil
	}

	manifest := &manifestProvider{byPath: make(map[string]domain.ExternalMetadata, len(staged))}
	for path, item := range staged {
		manifest.byPath[path] = item.Meta
	}

	runner := importer.Importer{DB: e.DB, Store: e.Store, Media: e.Media, ThumbMaxEdge: e.ThumbSize}
	result, err := runner.Run(ctx, importer.Options{
		SourceDir:     batchDir,
		OwnerUsername: e.Opts.OwnerUsername,
		Metadata:      manifest,
	})
	if err != nil {
		return fmt.Errorf("migrate: import batch: %w", err)
	}

	// Anything the importer could not place at all is an error against its item.
	for _, fe := range result.Errors {
		if item, ok := staged[cleanPath(fe.Path)]; ok {
			_ = recordMapping(ctx, e.DB, ownerID, src.Name(), KindAsset,
				item.SourceID, "", StatusError, fe.Err.Error(), run.ID)
			run.Errors++
		}
	}

	for _, ia := range result.Assets {
		item, ok := staged[cleanPath(ia.SourcePath)]
		if !ok {
			continue
		}
		status := StatusDone
		if ia.Duplicate {
			status = StatusDuplicate
			run.Duplicates++
		} else {
			run.Imported++
		}
		run.Processed++
		if err := recordMapping(ctx, e.DB, ownerID, src.Name(), KindAsset,
			item.SourceID, ia.AssetID, status, "", run.ID); err != nil {
			return err
		}
		if err := e.applyRelations(ctx, ownerID, ia, item, albums, tags); err != nil {
			e.Log.Warn("migration: relations failed", "asset", ia.AssetID,
				"source_id", item.SourceID, "err", err)
		}
	}

	if e.Opts.Progress != nil {
		fmt.Fprintf(e.Opts.Progress, "\rmigrated=%d duplicates=%d skipped=%d errors=%d",
			run.Imported, run.Duplicates, run.Skipped, run.Errors)
	}
	return nil
}

// downloadBatch fetches originals in parallel into batchDir, returning the
// staged absolute path for each item that arrived.
func (e *Engine) downloadBatch(ctx context.Context, src Source, ownerID string, run *Run, items []Item, batchDir string) (map[string]Item, error) {
	var (
		mu     sync.Mutex
		staged = make(map[string]Item, len(items))
	)
	sem := make(chan struct{}, e.Opts.parallel())
	var wg sync.WaitGroup

	for idx, item := range items {
		select {
		case <-ctx.Done():
			wg.Wait()
			return nil, ctx.Err()
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(idx int, item Item) {
			defer wg.Done()
			defer func() { <-sem }()

			path, err := e.fetchOne(ctx, src, item, batchDir, idx)
			if err != nil {
				mu.Lock()
				run.Errors++
				mu.Unlock()
				_ = recordMapping(ctx, e.DB, ownerID, src.Name(), KindAsset,
					item.SourceID, "", StatusError, err.Error(), run.ID)
				e.Log.Warn("migration: download failed", "source_id", item.SourceID,
					"filename", item.Filename, "err", err)
				return
			}
			mu.Lock()
			staged[path] = item
			mu.Unlock()
		}(idx, item)
	}
	wg.Wait()
	return staged, ctx.Err()
}

// fetchOne writes a single original into its own numbered subdirectory. The
// per-item subdirectory is what keeps two source photos both named IMG_0001.jpg
// from overwriting each other before the importer ever sees them.
func (e *Engine) fetchOne(ctx context.Context, src Source, item Item, batchDir string, idx int) (string, error) {
	dir := filepath.Join(batchDir, fmt.Sprintf("%06d", idx))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("stage dir: %w", err)
	}
	name := filepath.Base(item.Filename)
	if name == "." || name == ".." || name == string(filepath.Separator) || name == "" {
		name = item.SourceID
	}
	path := filepath.Join(dir, name)

	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", fmt.Errorf("create staged file: %w", err)
	}
	if err := src.Fetch(ctx, item, f); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("close staged file: %w", err)
	}
	return cleanPath(path), nil
}

// manifestProvider feeds the importer the metadata the source supplied,
// keyed by the staged file's absolute path.
type manifestProvider struct {
	byPath map[string]domain.ExternalMetadata
}

func (m *manifestProvider) Lookup(path string) (domain.ExternalMetadata, bool) {
	meta, ok := m.byPath[cleanPath(path)]
	return meta, ok
}

// cleanPath normalizes a path for map keys. The importer walks an absolutized
// root, so keys must be absolute and symlink-free on both sides.
func cleanPath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return filepath.Clean(abs)
}

func (e *Engine) ensureOwner(ctx context.Context, username string) (string, error) {
	var id string
	err := e.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ?`, username).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("migrate: lookup owner: %w", err)
	}
	newID, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("migrate: new owner id: %w", err)
	}
	if _, err := e.DB.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash) VALUES (?, ?, '')`,
		newID.String(), username); err != nil {
		return "", fmt.Errorf("migrate: create owner: %w", err)
	}
	return newID.String(), nil
}
