// Package importer walks user-supplied folders into Kuraki's write-once
// library storage and records asset metadata in SQLite.
package importer

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/domain"
	"github.com/kuraki-app/kuraki/internal/geo"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/kuraki-app/kuraki/internal/takeout"
	"github.com/zeebo/blake3"
)

const defaultOwnerUsername = "owner"
const defaultThumbMaxEdge = 512

// MetadataProvider supplies metadata a foreign system knows about a file that
// the file's own bytes do not carry. The Google Takeout resolver is the default
// implementation; a library migration substitutes its own.
type MetadataProvider interface {
	Lookup(path string) (domain.ExternalMetadata, bool)
}

// Options controls a single import run.
type Options struct {
	SourceDir        string
	DryRun           bool
	OwnerUsername    string
	Progress         io.Writer
	ThumbnailWorkers int

	// Metadata supplies external metadata per source file. When nil, the run
	// falls back to Google Takeout sidecar resolution — the historical
	// behaviour every existing caller relies on.
	Metadata MetadataProvider
}

// Result summarizes a completed import run.
type Result struct {
	Scanned    int
	Imported   int
	Skipped    int
	Duplicates int
	Errors     []FileError
	Bytes      int64

	// Assets records the asset each source file resolved to, including files
	// that turned out to be duplicates of an already-stored asset. A migration
	// needs this to attach albums and tags to the right rows — and needs it for
	// duplicates too, so that re-running a migration still files an
	// already-present photo into its album.
	Assets []ImportedAsset
}

// ImportedAsset ties a source file to the asset it became.
type ImportedAsset struct {
	SourcePath string
	AssetID    string
	Duplicate  bool
}

// FileError captures a per-file failure while allowing the import to continue.
type FileError struct {
	Path string
	Err  error
}

// Importer owns the dependencies needed by the import workflow.
type Importer struct {
	DB    *sql.DB
	Store storage.Storage
	Media media.Processor
	// ThumbMaxEdge is the longest-edge size for generated thumbnails.
	// Zero falls back to the default.
	ThumbMaxEdge int

	metadata MetadataProvider
}

func (i *Importer) thumbEdge() int {
	if i.ThumbMaxEdge > 0 {
		return i.ThumbMaxEdge
	}
	return defaultThumbMaxEdge
}

type candidate struct {
	Path         string
	Kind         domain.MediaType
	FallbackMime string
}

type derivativeJob struct {
	AssetID string
	Path    string
	Meta    media.Meta
}

// Run recursively imports supported media files from opts.SourceDir.
func (i *Importer) Run(ctx context.Context, opts Options) (Result, error) {
	if i.DB == nil {
		return Result{}, fmt.Errorf("importer: db is nil")
	}
	if i.Store == nil {
		return Result{}, fmt.Errorf("importer: storage is nil")
	}
	if i.Media == nil {
		return Result{}, fmt.Errorf("importer: media processor is nil")
	}
	// A fresh Takeout resolver per run unless the caller supplies its own
	// provider; the resolver caches per-directory sidecar indexes and must not
	// outlive the directory it indexed.
	i.metadata = opts.Metadata
	if i.metadata == nil {
		i.metadata = takeout.NewResolver()
	}
	if opts.SourceDir == "" {
		return Result{}, fmt.Errorf("importer: source dir is required")
	}
	username := opts.OwnerUsername
	if username == "" {
		username = defaultOwnerUsername
	}

	root, err := filepath.Abs(opts.SourceDir)
	if err != nil {
		return Result{}, fmt.Errorf("importer: resolve source dir: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return Result{}, fmt.Errorf("importer: stat source dir: %w", err)
	}
	if !info.IsDir() {
		return Result{}, fmt.Errorf("importer: source is not a directory: %s", root)
	}

	var ownerID string
	if opts.DryRun {
		ownerID, err = i.lookupOwner(ctx, username)
		if err != nil {
			return Result{}, err
		}
	} else {
		ownerID, err = i.ensureOwner(ctx, username)
		if err != nil {
			return Result{}, err
		}
	}

	result := Result{}
	files := make([]candidate, 0)
	walkErr := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			result.Errors = append(result.Errors, FileError{Path: path, Err: walkErr})
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		cap, ok, classifyErr := media.ClassifyFile(path)
		if classifyErr != nil {
			result.Errors = append(result.Errors, FileError{Path: path, Err: classifyErr})
			return nil
		}
		if !ok {
			if _, namedMedia := media.Classify(path); namedMedia {
				result.Errors = append(result.Errors, FileError{Path: path, Err: fmt.Errorf("unsupported media content")})
			}
			return nil
		}
		files = append(files, candidate{Path: path, Kind: cap.MediaType, FallbackMime: cap.MimeType})
		return nil
	})
	if walkErr != nil {
		return result, fmt.Errorf("importer: walk source: %w", walkErr)
	}
	result.Scanned = len(files)

	derivatives := make([]derivativeJob, 0)
	for idx, file := range files {
		job, err := i.importFile(ctx, ownerID, file.Path, file.Kind, file.FallbackMime, opts.DryRun, &result)
		if err != nil {
			result.Errors = append(result.Errors, FileError{Path: file.Path, Err: err})
		}
		if job != nil {
			derivatives = append(derivatives, *job)
		}
		writeProgress(opts.Progress, idx+1, len(files), result, file.Path)
	}
	if opts.Progress != nil && len(files) > 0 {
		fmt.Fprintln(opts.Progress)
	}
	if !opts.DryRun {
		for _, fileErr := range i.runDerivativeWorkers(ctx, derivatives, opts.ThumbnailWorkers) {
			result.Errors = append(result.Errors, fileErr)
		}
	}
	return result, nil
}

func (i *Importer) importFile(ctx context.Context, ownerID, path string, kind domain.MediaType, fallbackMime string, dryRun bool, result *Result) (job *derivativeJob, err error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat: %w", err)
	}
	mtime := info.ModTime().UTC()
	if !dryRun {
		defer func() {
			if err != nil {
				_ = i.setImportState(ctx, ownerID, path, info.Size(), mtime, "", "error", err.Error())
			}
		}()
	}

	if !dryRun {
		skip, err := i.alreadyProcessed(ctx, ownerID, path, info.Size(), mtime)
		if err != nil {
			return nil, err
		}
		if skip {
			result.Skipped++
			return nil, nil
		}
		if err := i.setImportState(ctx, ownerID, path, info.Size(), mtime, "", "pending", ""); err != nil {
			return nil, err
		}
	}

	hash, err := hashFile(path)
	if err != nil {
		return nil, err
	}
	if ownerID != "" {
		existingID, err := i.assetExists(ctx, ownerID, hash)
		if err != nil {
			return nil, err
		}
		if existingID != "" {
			result.Duplicates++
			result.Skipped++
			// Report which asset this file already is. A migration reruns over
			// the same library routinely and still needs to file the existing
			// asset into its albums and tags.
			result.Assets = append(result.Assets, ImportedAsset{
				SourcePath: path, AssetID: existingID, Duplicate: true,
			})
			if !dryRun {
				return nil, i.setImportState(ctx, ownerID, path, info.Size(), mtime, hash, "skipped", "")
			}
			return nil, nil
		}
	}

	meta := i.probe(ctx, path, kind, fallbackMime)
	takenAt := meta.TakenAt
	gpsLat, gpsLon := meta.GPSLat, meta.GPSLon
	cameraMake, cameraModel := meta.CameraMake, meta.CameraModel
	var description string
	var favorite, archived, hidden bool
	var rating int

	// External metadata (Takeout sidecar, or a source server during a library
	// migration) is authoritative for capture time and fills in the
	// GPS/caption/favorite and organization state that exported files lack.
	// EXIF still wins for GPS, which is measured rather than asserted.
	if sc, ok := i.metadata.Lookup(path); ok {
		if sc.TakenAt != nil {
			takenAt = sc.TakenAt
		}
		if gpsLat == nil && sc.Lat != nil {
			gpsLat, gpsLon = sc.Lat, sc.Lon
		}
		if cameraMake == "" {
			cameraMake = sc.CameraMake
		}
		if cameraModel == "" {
			cameraModel = sc.CameraModel
		}
		description = sc.Description
		favorite = sc.Favorite
		archived = sc.Archived
		hidden = sc.Hidden
		rating = clampRating(sc.Rating)
	}

	// Last resort: the file's own modification time.
	//
	// Nothing else supplies a date for media that carries no EXIF capture time
	// and has no sidecar -- screenshots, exported renders, most things a screen
	// recorder or a messaging app writes. Those imported with `taken_at` NULL,
	// which is not "unknown" to a client so much as unusable: they collapsed
	// into a single "Undated" bucket at the top of the timeline, in an order
	// nobody chose, and no date filter could reach them.
	//
	// An mtime is a weaker claim than EXIF and is deliberately ranked below it
	// (and below a Takeout/migration sidecar). It is, however, the time the
	// bytes were last written, which for a phone upload is the capture time the
	// client stamped on the staged file -- see the capture complete handler.
	if takenAt == nil && !mtime.IsZero() {
		fallback := mtime.UTC()
		takenAt = &fallback
	}

	storageDate := mtime
	if takenAt != nil {
		storageDate = takenAt.UTC()
	}

	if dryRun {
		result.Imported++
		result.Bytes += info.Size()
		return nil, nil
	}

	assetID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("new asset id: %w", err)
	}
	originalPath := originalPath(storageDate, assetID.String(), filepath.Ext(path))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open source: %w", err)
	}
	written, writeErr := i.Store.Write(ctx, "originals/"+originalPath, f)
	closeErr := f.Close()
	if writeErr != nil {
		return nil, fmt.Errorf("write original: %w", writeErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close source: %w", closeErr)
	}
	if written != info.Size() {
		return nil, fmt.Errorf("write original: wrote %d bytes, want %d", written, info.Size())
	}

	var placeCity, placeCountry string
	if gpsLat != nil && gpsLon != nil {
		if p, ok := geo.Reverse(*gpsLat, *gpsLon); ok {
			placeCity, placeCountry = p.City, p.Country
		}
	}

	if err := i.insertAsset(ctx, assetRow{
		ID:           assetID.String(),
		OwnerID:      ownerID,
		ContentHash:  hash,
		OriginalPath: originalPath,
		Filename:     filepath.Base(path),
		MimeType:     meta.MimeType,
		MediaType:    kind,
		Width:        meta.Width,
		Height:       meta.Height,
		SizeBytes:    info.Size(),
		TakenAt:      takenAt,
		CameraMake:   cameraMake,
		CameraModel:  cameraModel,
		GPSLat:       gpsLat,
		GPSLon:       gpsLon,
		DurationMS:   meta.DurationMS,
		PlaceCity:    placeCity,
		PlaceCountry: placeCountry,
		Favorite:     favorite,
		Description:  description,
		WebViewable:  meta.WebViewable,
		Rating:       rating,
		Archived:     archived,
		Hidden:       hidden,
	}); err != nil {
		return nil, err
	}
	if err := i.setImportState(ctx, ownerID, path, info.Size(), mtime, hash, "done", ""); err != nil {
		return nil, err
	}

	result.Imported++
	result.Bytes += info.Size()
	result.Assets = append(result.Assets, ImportedAsset{SourcePath: path, AssetID: assetID.String()})
	return &derivativeJob{AssetID: assetID.String(), Path: path, Meta: meta}, nil
}

func (i *Importer) runDerivativeWorkers(ctx context.Context, jobs []derivativeJob, workers int) []FileError {
	if len(jobs) == 0 {
		return nil
	}
	workers = normalizeWorkers(workers)
	jobCh := make(chan derivativeJob)
	errCh := make(chan FileError, len(jobs)*3)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				if err := i.createThumbnail(ctx, job.AssetID, job.Path, job.Meta); err != nil {
					i.recordMediaIssue(ctx, job.AssetID, "thumbnail", err)
					errCh <- FileError{Path: job.Path, Err: err}
				}
				if err := i.createPoster(ctx, job.AssetID, job.Path, job.Meta); err != nil {
					i.recordMediaIssue(ctx, job.AssetID, "poster", err)
					errCh <- FileError{Path: job.Path, Err: err}
				}
				if err := i.createPreview(ctx, job.AssetID, job.Path, job.Meta); err != nil {
					kind := "preview"
					if job.Meta.MediaType == domain.MediaVideo {
						kind = "playback"
					}
					i.recordMediaIssue(ctx, job.AssetID, kind, err)
					errCh <- FileError{Path: job.Path, Err: err}
				}
			}
		}()
	}
	for _, job := range jobs {
		select {
		case <-ctx.Done():
			errCh <- FileError{Path: job.Path, Err: ctx.Err()}
		case jobCh <- job:
		}
	}
	close(jobCh)
	wg.Wait()
	close(errCh)

	errs := make([]FileError, 0)
	for err := range errCh {
		errs = append(errs, err)
	}
	return errs
}

func (i *Importer) createThumbnail(ctx context.Context, assetID, srcPath string, meta media.Meta) error {
	if meta.MediaType != domain.MediaImage {
		return nil
	}
	edge := i.thumbEdge()
	var buf bytes.Buffer
	if err := i.Media.Thumbnail(ctx, srcPath, edge, &buf); err != nil {
		if errors.Is(err, media.ErrUnsupported) {
			return nil
		}
		return fmt.Errorf("create thumbnail: encode derivative: %w", err)
	}

	// Perceptual hash from the thumbnail bytes (works for any image type since
	// the thumbnail is a web-decodable format) — powers duplicate review.
	data := buf.Bytes()
	if h, ok := media.PerceptualHash(data); ok {
		_, _ = i.DB.ExecContext(ctx, `UPDATE assets SET phash = ? WHERE id = ?`, int64(h), assetID)
	}

	format, ext := thumbnailFormat(i.Media)
	rel := fmt.Sprintf("derivatives/%s/thumb_%d.%s", assetID, edge, ext)
	if _, err := i.Store.Write(ctx, rel, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("create thumbnail: write derivative: %w", err)
	}
	tw, th := thumbSize(meta.Width, meta.Height, edge)
	if _, err := i.DB.ExecContext(ctx, `
		INSERT INTO derivatives (asset_id, kind, format, path, width, height)
		VALUES (?, 'thumb', ?, ?, ?, ?)
		ON CONFLICT(asset_id, kind) DO UPDATE SET
			format = excluded.format,
			path = excluded.path,
			width = excluded.width,
			height = excluded.height
	`, assetID, format, strings.TrimPrefix(rel, "derivatives/"), tw, th); err != nil {
		return fmt.Errorf("create thumbnail: insert derivative: %w", err)
	}
	return nil
}

func (i *Importer) createPoster(ctx context.Context, assetID, srcPath string, meta media.Meta) error {
	if meta.MediaType != domain.MediaVideo {
		return nil
	}
	var buf bytes.Buffer
	if err := i.Media.Poster(ctx, srcPath, &buf); err != nil {
		if errors.Is(err, media.ErrUnsupported) {
			return nil
		}
		return fmt.Errorf("create poster: encode derivative: %w", err)
	}
	if h, ok := media.PerceptualHash(buf.Bytes()); ok {
		_, _ = i.DB.ExecContext(ctx, `UPDATE assets SET phash = ? WHERE id = ?`, int64(h), assetID)
	}
	rel := fmt.Sprintf("derivatives/%s/poster.jpg", assetID)
	if _, err := i.Store.Write(ctx, rel, &buf); err != nil {
		return fmt.Errorf("create poster: write derivative: %w", err)
	}
	if _, err := i.DB.ExecContext(ctx, `
		INSERT INTO derivatives (asset_id, kind, format, path)
		VALUES (?, 'poster', 'jpeg', ?)
		ON CONFLICT(asset_id, kind) DO UPDATE SET
			format = excluded.format,
			path = excluded.path
	`, assetID, strings.TrimPrefix(rel, "derivatives/")); err != nil {
		return fmt.Errorf("create poster: insert derivative: %w", err)
	}
	return nil
}

// createPreview produces a safe browser representation only when the original
// is not known to be web-viewable. Originals remain untouched and downloadable.
func (i *Importer) createPreview(ctx context.Context, assetID, srcPath string, meta media.Meta) error {
	if meta.WebViewable {
		return nil
	}
	if meta.MediaType == domain.MediaImage {
		var buf bytes.Buffer
		const previewEdge = 2560
		if err := i.Media.Thumbnail(ctx, srcPath, previewEdge, &buf); err != nil {
			if errors.Is(err, media.ErrUnsupported) {
				return fmt.Errorf("create preview: no decoder available: %w", err)
			}
			return fmt.Errorf("create preview: encode derivative: %w", err)
		}
		format, ext := thumbnailFormat(i.Media)
		rel := fmt.Sprintf("derivatives/%s/preview.%s", assetID, ext)
		if _, err := i.Store.Write(ctx, rel, &buf); err != nil {
			return fmt.Errorf("create preview: write derivative: %w", err)
		}
		w, h := thumbSize(meta.Width, meta.Height, previewEdge)
		if err := i.upsertPreview(ctx, assetID, format, strings.TrimPrefix(rel, "derivatives/"), w, h); err != nil {
			return err
		}
		return i.markWebViewable(ctx, assetID)
	}
	if meta.MediaType != domain.MediaVideo {
		return nil
	}

	tmp, err := os.CreateTemp("", "kuraki-playback-*.mp4")
	if err != nil {
		return fmt.Errorf("create playback: temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("create playback: close temp file: %w", err)
	}
	defer os.Remove(tmpPath)
	if err := media.TranscodeVideo(ctx, srcPath, tmpPath); err != nil {
		return fmt.Errorf("create playback: %w", err)
	}
	f, err := os.Open(tmpPath)
	if err != nil {
		return fmt.Errorf("create playback: open derivative: %w", err)
	}
	defer f.Close()
	rel := fmt.Sprintf("derivatives/%s/playback.mp4", assetID)
	if _, err := i.Store.Write(ctx, rel, f); err != nil {
		return fmt.Errorf("create playback: write derivative: %w", err)
	}
	if err := i.upsertPreview(ctx, assetID, "mp4", strings.TrimPrefix(rel, "derivatives/"), meta.Width, meta.Height); err != nil {
		return err
	}
	return i.markWebViewable(ctx, assetID)
}

func (i *Importer) upsertPreview(ctx context.Context, assetID, format, path string, width, height int) error {
	if _, err := i.DB.ExecContext(ctx, `
		INSERT INTO derivatives (asset_id, kind, format, path, width, height)
		VALUES (?, 'preview', ?, ?, ?, ?)
		ON CONFLICT(asset_id, kind) DO UPDATE SET
			format = excluded.format,
			path = excluded.path,
			width = excluded.width,
			height = excluded.height
	`, assetID, format, path, width, height); err != nil {
		return fmt.Errorf("create preview: insert derivative: %w", err)
	}
	return nil
}

func (i *Importer) markWebViewable(ctx context.Context, assetID string) error {
	if _, err := i.DB.ExecContext(ctx, `UPDATE assets SET web_viewable = 1 WHERE id = ?`, assetID); err != nil {
		return fmt.Errorf("create preview: mark viewable: %w", err)
	}
	return nil
}

func (i *Importer) recordMediaIssue(ctx context.Context, assetID, kind string, cause error) {
	if _, err := i.DB.ExecContext(ctx, `
		INSERT INTO media_issues (asset_id, kind, message)
		VALUES (?, ?, ?)
		ON CONFLICT(asset_id, kind) DO UPDATE SET message = excluded.message, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
	`, assetID, kind, cause.Error()); err != nil {
		return
	}
}

func (i *Importer) clearMediaIssue(ctx context.Context, assetID, kind string) {
	_, _ = i.DB.ExecContext(ctx, `DELETE FROM media_issues WHERE asset_id = ? AND kind = ?`, assetID, kind)
}

// RebuildDerivatives regenerates an asset's thumbnail, poster, preview, and
// playback derivatives from its stored original, clearing any media issues it
// resolves. It powers the media-health retry action; the original is untouched.
func (i *Importer) RebuildDerivatives(ctx context.Context, assetID string) error {
	var originalPath, mediaType, mimeType string
	var width, height, webViewable int
	var durationMS int64
	err := i.DB.QueryRowContext(ctx, `
		SELECT original_path, media_type, mime_type, width, height, web_viewable, duration_ms
		FROM assets WHERE id = ? AND deleted_at IS NULL`, assetID).
		Scan(&originalPath, &mediaType, &mimeType, &width, &height, &webViewable, &durationMS)
	if err != nil {
		return fmt.Errorf("rebuild: load asset: %w", err)
	}

	// Copy the original to a temp file so the media backend has a real path;
	// this works for any storage backend, not only the local filesystem.
	rc, err := i.Store.Open(ctx, "originals/"+originalPath)
	if err != nil {
		return fmt.Errorf("rebuild: open original: %w", err)
	}
	tmp, err := os.CreateTemp("", "kuraki-rebuild-*"+filepath.Ext(originalPath))
	if err != nil {
		rc.Close()
		return fmt.Errorf("rebuild: temp file: %w", err)
	}
	tmpPath := tmp.Name()
	_, copyErr := io.Copy(tmp, rc)
	rc.Close()
	tmp.Close()
	defer os.Remove(tmpPath)
	if copyErr != nil {
		return fmt.Errorf("rebuild: copy original: %w", copyErr)
	}

	meta := media.Meta{
		MediaType:   domain.MediaType(mediaType),
		MimeType:    mimeType,
		Width:       width,
		Height:      height,
		WebViewable: webViewable != 0,
		DurationMS:  durationMS,
	}

	var firstErr error
	run := func(kind string, fn func() error) {
		if err := fn(); err != nil {
			i.recordMediaIssue(ctx, assetID, kind, err)
			if firstErr == nil {
				firstErr = err
			}
			return
		}
		i.clearMediaIssue(ctx, assetID, kind)
	}
	run("thumbnail", func() error { return i.createThumbnail(ctx, assetID, tmpPath, meta) })
	previewKind := "preview"
	if meta.MediaType == domain.MediaVideo {
		run("poster", func() error { return i.createPoster(ctx, assetID, tmpPath, meta) })
		previewKind = "playback"
	}
	run(previewKind, func() error { return i.createPreview(ctx, assetID, tmpPath, meta) })
	return firstErr
}

func (i *Importer) probe(ctx context.Context, path string, kind domain.MediaType, fallbackMime string) media.Meta {
	if kind == domain.MediaVideo {
		info, err := media.ProbeVideo(ctx, path, fallbackMime)
		if err != nil {
			return media.Meta{MimeType: fallbackMime, MediaType: kind}
		}
		return media.Meta{
			MimeType:    fallbackMime,
			MediaType:   kind,
			Width:       info.Width,
			Height:      info.Height,
			DurationMS:  info.DurationMS,
			WebViewable: info.WebViewable,
		}
	}
	meta, err := i.Media.Probe(ctx, path)
	if err != nil {
		cap, _ := media.Classify(path)
		return media.Meta{MimeType: fallbackMime, MediaType: kind, WebViewable: cap.WebViewable}
	}
	if meta.MimeType == "" {
		meta.MimeType = fallbackMime
	}
	if meta.MediaType == "" {
		meta.MediaType = kind
	}
	meta.WebViewable = meta.WebViewable && media.IsWebImage(meta.MimeType)
	return meta
}

func (i *Importer) lookupOwner(ctx context.Context, username string) (string, error) {
	var id string
	err := i.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ?`, username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("importer: lookup owner: %w", err)
	}
	return id, nil
}

func (i *Importer) ensureOwner(ctx context.Context, username string) (string, error) {
	if id, err := i.lookupOwner(ctx, username); err != nil || id != "" {
		return id, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("importer: new owner id: %w", err)
	}
	if _, err := i.DB.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash) VALUES (?, ?, '')`,
		id.String(), username); err != nil {
		return "", fmt.Errorf("importer: create owner: %w", err)
	}
	return id.String(), nil
}

// alreadyProcessed reports whether this owner has already imported this exact
// file. Scoped by owner: two people importing the same shared source path must
// each get their own copy, not have the second silently skipped.
func (i *Importer) alreadyProcessed(ctx context.Context, ownerID, path string, size int64, mtime time.Time) (bool, error) {
	var status string
	err := i.DB.QueryRowContext(ctx,
		`SELECT status FROM import_state
		 WHERE owner_id = ? AND source_path = ? AND size = ? AND mtime = ?`,
		ownerID, path, size, timeText(mtime)).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("importer: read import state: %w", err)
	}
	return status == "done" || status == "skipped", nil
}

func (i *Importer) setImportState(ctx context.Context, ownerID, path string, size int64, mtime time.Time, hash, status, message string) error {
	var importedAt any
	if status == "done" || status == "skipped" || status == "error" {
		importedAt = timeText(time.Now().UTC())
	}
	_, err := i.DB.ExecContext(ctx, `
		INSERT INTO import_state (owner_id, source_path, size, mtime, content_hash, status, error, imported_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_id, source_path) DO UPDATE SET
			size = excluded.size,
			mtime = excluded.mtime,
			content_hash = excluded.content_hash,
			status = excluded.status,
			error = excluded.error,
			imported_at = excluded.imported_at
	`, ownerID, path, size, timeText(mtime), nullString(hash), status, message, importedAt)
	if err != nil {
		return fmt.Errorf("importer: set import state: %w", err)
	}
	return nil
}

// assetExists returns the id of an already-stored asset with this content hash,
// or "" when the content is new.
func (i *Importer) assetExists(ctx context.Context, ownerID, hash string) (string, error) {
	var id string
	err := i.DB.QueryRowContext(ctx,
		`SELECT id FROM assets WHERE owner_id = ? AND content_hash = ?`,
		ownerID, hash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("importer: check duplicate: %w", err)
	}
	return id, nil
}

// clampRating keeps a foreign rating inside the 0-5 range the assets CHECK
// constraint allows, so one odd value cannot fail an entire migration batch.
func clampRating(r int) int {
	if r < 0 {
		return 0
	}
	if r > 5 {
		return 5
	}
	return r
}

type assetRow struct {
	ID           string
	OwnerID      string
	ContentHash  string
	OriginalPath string
	Filename     string
	MimeType     string
	MediaType    domain.MediaType
	Width        int
	Height       int
	SizeBytes    int64
	TakenAt      *time.Time
	CameraMake   string
	CameraModel  string
	GPSLat       *float64
	GPSLon       *float64
	DurationMS   int64
	PlaceCity    string
	PlaceCountry string
	Favorite     bool
	Description  string
	WebViewable  bool
	Rating       int
	Archived     bool
	Hidden       bool
}

func (i *Importer) insertAsset(ctx context.Context, row assetRow) error {
	tx, err := i.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("importer: begin asset insert: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO assets (
			id, owner_id, content_hash, original_path, filename, mime_type, media_type,
			width, height, size_bytes, taken_at, camera_make, camera_model, gps_lat,
			gps_lon, duration_ms, place_city, place_country, favorite, description, web_viewable,
			rating, archived, hidden
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, row.ID, row.OwnerID, row.ContentHash, row.OriginalPath, row.Filename, row.MimeType,
		string(row.MediaType), row.Width, row.Height, row.SizeBytes, timePtrText(row.TakenAt),
		row.CameraMake, row.CameraModel, floatPtr(row.GPSLat), floatPtr(row.GPSLon), row.DurationMS,
		nullString(row.PlaceCity), nullString(row.PlaceCountry), boolInt(row.Favorite),
		nullString(row.Description), boolInt(row.WebViewable),
		clampRating(row.Rating), boolInt(row.Archived), boolInt(row.Hidden))
	if err != nil {
		return fmt.Errorf("importer: insert asset: %w", err)
	}

	takenText := ""
	if row.TakenAt != nil {
		takenText = row.TakenAt.UTC().Format("2006-01-02")
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description, ocr_text) VALUES (?, ?, ?, ?, ?, '')`,
		row.ID, row.Filename, row.CameraModel, takenText, row.Description); err != nil {
		return fmt.Errorf("importer: insert asset fts: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'create', ?)`,
		row.ID, row.OwnerID); err != nil {
		return fmt.Errorf("importer: insert change log: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("importer: commit asset insert: %w", err)
	}
	return nil
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("hash open: %w", err)
	}
	defer f.Close()

	h := blake3.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("hash read: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func originalPath(t time.Time, id, ext string) string {
	ext = strings.ToLower(ext)
	return fmt.Sprintf("%04d/%02d/%s%s", t.Year(), int(t.Month()), id, ext)
}

func thumbSize(w, h, maxEdge int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	if w <= maxEdge && h <= maxEdge {
		return w, h
	}
	if w >= h {
		return maxEdge, max(1, h*maxEdge/w)
	}
	return max(1, w*maxEdge/h), maxEdge
}

func thumbnailFormat(processor media.Processor) (format string, extension string) {
	if formatter, ok := processor.(media.ThumbnailFormatter); ok {
		format, extension = formatter.ThumbnailFormat()
		if format != "" && extension != "" {
			return format, extension
		}
	}
	return "jpeg", "jpg"
}

func normalizeWorkers(workers int) int {
	if workers <= 0 {
		workers = min(runtime.GOMAXPROCS(0), 2)
	}
	if workers < 1 {
		return 1
	}
	if workers > 8 {
		return 8
	}
	return workers
}

func writeProgress(w io.Writer, done, total int, result Result, file string) {
	if w == nil || total == 0 {
		return
	}
	const width = 24
	filled := done * width / total
	bar := strings.Repeat("#", filled) + strings.Repeat("-", width-filled)
	fmt.Fprintf(w, "\r[%s] %d/%d imported=%d skipped=%d errors=%d %s",
		bar,
		done,
		total,
		result.Imported,
		result.Skipped,
		len(result.Errors),
		filepath.Base(file),
	)
}

func timeText(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func timePtrText(t *time.Time) any {
	if t == nil {
		return nil
	}
	return timeText(*t)
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func floatPtr(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}
