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
	"mime"
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

// Options controls a single import run.
type Options struct {
	SourceDir        string
	DryRun           bool
	OwnerUsername    string
	Progress         io.Writer
	ThumbnailWorkers int
}

// Result summarizes a completed import run.
type Result struct {
	Scanned    int
	Imported   int
	Skipped    int
	Duplicates int
	Errors     []FileError
	Bytes      int64
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

	resolver *takeout.Resolver
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
	i.resolver = takeout.NewResolver()
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
		kind, fallbackMime, ok := mediaFromExt(path)
		if !ok {
			return nil
		}
		files = append(files, candidate{Path: path, Kind: kind, FallbackMime: fallbackMime})
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
				_ = i.setImportState(ctx, path, info.Size(), mtime, "", "error", err.Error())
			}
		}()
	}

	if !dryRun {
		skip, err := i.alreadyProcessed(ctx, path, info.Size(), mtime)
		if err != nil {
			return nil, err
		}
		if skip {
			result.Skipped++
			return nil, nil
		}
		if err := i.setImportState(ctx, path, info.Size(), mtime, "", "pending", ""); err != nil {
			return nil, err
		}
	}

	hash, err := hashFile(path)
	if err != nil {
		return nil, err
	}
	if ownerID != "" {
		duplicate, err := i.assetExists(ctx, ownerID, hash)
		if err != nil {
			return nil, err
		}
		if duplicate {
			result.Duplicates++
			result.Skipped++
			if !dryRun {
				return nil, i.setImportState(ctx, path, info.Size(), mtime, hash, "skipped", "")
			}
			return nil, nil
		}
	}

	meta := i.probe(ctx, path, kind, fallbackMime)
	takenAt := meta.TakenAt
	gpsLat, gpsLon := meta.GPSLat, meta.GPSLon
	var description string
	var favorite bool

	// Google Takeout sidecar (if present) is authoritative for capture time and
	// fills in GPS/caption/favorite that the exported files often lack.
	if sc, ok := i.resolver.Lookup(path); ok {
		if sc.TakenAt != nil {
			takenAt = sc.TakenAt
		}
		if gpsLat == nil && sc.Lat != nil {
			gpsLat, gpsLon = sc.Lat, sc.Lon
		}
		description = sc.Description
		favorite = sc.Favorite
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
		CameraMake:   meta.CameraMake,
		CameraModel:  meta.CameraModel,
		GPSLat:       gpsLat,
		GPSLon:       gpsLon,
		DurationMS:   meta.DurationMS,
		PlaceCity:    placeCity,
		PlaceCountry: placeCountry,
		Favorite:     favorite,
		Description:  description,
	}); err != nil {
		return nil, err
	}
	if err := i.setImportState(ctx, path, info.Size(), mtime, hash, "done", ""); err != nil {
		return nil, err
	}

	result.Imported++
	result.Bytes += info.Size()
	return &derivativeJob{AssetID: assetID.String(), Path: path, Meta: meta}, nil
}

func (i *Importer) runDerivativeWorkers(ctx context.Context, jobs []derivativeJob, workers int) []FileError {
	if len(jobs) == 0 {
		return nil
	}
	workers = normalizeWorkers(workers)
	jobCh := make(chan derivativeJob)
	errCh := make(chan FileError, len(jobs))
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				if err := i.createThumbnail(ctx, job.AssetID, job.Path, job.Meta); err != nil {
					errCh <- FileError{Path: job.Path, Err: err}
					continue
				}
				if err := i.createPoster(ctx, job.AssetID, job.Path, job.Meta); err != nil {
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

	format, ext := thumbnailFormat(i.Media)
	rel := fmt.Sprintf("derivatives/%s/thumb_%d.%s", assetID, edge, ext)
	if _, err := i.Store.Write(ctx, rel, &buf); err != nil {
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

func (i *Importer) probe(ctx context.Context, path string, kind domain.MediaType, fallbackMime string) media.Meta {
	meta, err := i.Media.Probe(ctx, path)
	if err != nil {
		return media.Meta{MimeType: fallbackMime, MediaType: kind}
	}
	if meta.MimeType == "" {
		meta.MimeType = fallbackMime
	}
	if meta.MediaType == "" {
		meta.MediaType = kind
	}
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

func (i *Importer) alreadyProcessed(ctx context.Context, path string, size int64, mtime time.Time) (bool, error) {
	var status string
	err := i.DB.QueryRowContext(ctx,
		`SELECT status FROM import_state WHERE source_path = ? AND size = ? AND mtime = ?`,
		path, size, timeText(mtime)).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("importer: read import state: %w", err)
	}
	return status == "done" || status == "skipped", nil
}

func (i *Importer) setImportState(ctx context.Context, path string, size int64, mtime time.Time, hash, status, message string) error {
	var importedAt any
	if status == "done" || status == "skipped" || status == "error" {
		importedAt = timeText(time.Now().UTC())
	}
	_, err := i.DB.ExecContext(ctx, `
		INSERT INTO import_state (source_path, size, mtime, content_hash, status, error, imported_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_path) DO UPDATE SET
			size = excluded.size,
			mtime = excluded.mtime,
			content_hash = excluded.content_hash,
			status = excluded.status,
			error = excluded.error,
			imported_at = excluded.imported_at
	`, path, size, timeText(mtime), nullString(hash), status, message, importedAt)
	if err != nil {
		return fmt.Errorf("importer: set import state: %w", err)
	}
	return nil
}

func (i *Importer) assetExists(ctx context.Context, ownerID, hash string) (bool, error) {
	var id string
	err := i.DB.QueryRowContext(ctx,
		`SELECT id FROM assets WHERE owner_id = ? AND content_hash = ?`,
		ownerID, hash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("importer: check duplicate: %w", err)
	}
	return true, nil
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
			gps_lon, duration_ms, place_city, place_country, favorite, description
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, row.ID, row.OwnerID, row.ContentHash, row.OriginalPath, row.Filename, row.MimeType,
		string(row.MediaType), row.Width, row.Height, row.SizeBytes, timePtrText(row.TakenAt),
		row.CameraMake, row.CameraModel, floatPtr(row.GPSLat), floatPtr(row.GPSLon), row.DurationMS,
		nullString(row.PlaceCity), nullString(row.PlaceCountry), boolInt(row.Favorite),
		nullString(row.Description))
	if err != nil {
		return fmt.Errorf("importer: insert asset: %w", err)
	}

	takenText := ""
	if row.TakenAt != nil {
		takenText = row.TakenAt.UTC().Format("2006-01-02")
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description) VALUES (?, ?, ?, ?, ?)`,
		row.ID, row.Filename, row.CameraModel, takenText, row.Description); err != nil {
		return fmt.Errorf("importer: insert asset fts: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op) VALUES ('asset', ?, 'create')`,
		row.ID); err != nil {
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

func mediaFromExt(path string) (domain.MediaType, string, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff":
		return domain.MediaImage, mimeForExt(ext, "image/"+strings.TrimPrefix(ext, ".")), true
	case ".mp4", ".m4v", ".mov", ".webm":
		return domain.MediaVideo, mimeForExt(ext, "video/"+strings.TrimPrefix(ext, ".")), true
	default:
		return "", "", false
	}
}

func mimeForExt(ext, fallback string) string {
	if ext == ".jpg" {
		return "image/jpeg"
	}
	if ext == ".mov" {
		return "video/quicktime"
	}
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	return fallback
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
