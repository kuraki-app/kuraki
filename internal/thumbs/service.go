package thumbs

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kuraki-app/kuraki/internal/domain"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
	"golang.org/x/sync/singleflight"
)

const flightTimeout = 30 * time.Second

// Service resolves and lazily renders thumbnail tiers. Safe for concurrent use;
// zero Workers/MaxQueue/MediumEdge pick defaults on first call.
type Service struct {
	DB         *sql.DB
	Store      storage.Storage
	Media      media.Processor
	Log        *slog.Logger
	MediumEdge int
	Workers    int
	MaxQueue   int

	once    sync.Once
	sem     chan struct{}
	sf      singleflight.Group
	waiting atomic.Int64

	hits, generated, coalesced, busy, errs, inflight, generateNanos atomic.Int64
}

// Snapshot is a point-in-time copy of the service counters for /metrics.
type Snapshot struct {
	Hits            int64   `json:"hits_total"`
	Generated       int64   `json:"generated_total"`
	Coalesced       int64   `json:"coalesced_total"`
	Busy            int64   `json:"busy_total"`
	Errors          int64   `json:"errors_total"`
	Inflight        int64   `json:"inflight"`
	GenerateSeconds float64 `json:"generate_seconds_sum"`
}

func (s *Service) Snapshot() Snapshot {
	return Snapshot{
		Hits: s.hits.Load(), Generated: s.generated.Load(), Coalesced: s.coalesced.Load(),
		Busy: s.busy.Load(), Errors: s.errs.Load(), Inflight: s.inflight.Load(),
		GenerateSeconds: time.Duration(s.generateNanos.Load()).Seconds(),
	}
}

func (s *Service) init() {
	s.once.Do(func() {
		if s.Workers < 1 {
			s.Workers = max(1, runtime.GOMAXPROCS(0)/2)
		}
		if s.MaxQueue < 1 {
			s.MaxQueue = 64
		}
		if s.MediumEdge < 1 {
			s.MediumEdge = 512
		}
		s.sem = make(chan struct{}, s.Workers)
	})
}

type assetState struct {
	mediaType, originalPath string
	externalPath            sql.NullString
	gen, width, height      int

	thumbFormat, thumbPath   sql.NullString
	thumbW, thumbH           sql.NullInt64
	posterFormat, posterPath sql.NullString

	variantGen                 sql.NullInt64
	variantFormat, variantPath sql.NullString
	variantW, variantH         sql.NullInt64

	previewFormat, previewPath sql.NullString
	previewW, previewH         sql.NullInt64
}

const stateSQL = `
	SELECT a.media_type, a.original_path, a.external_path, a.derivative_gen, a.width, a.height,
	       t.format, t.path, t.width, t.height,
	       p.format, p.path,
	       v.gen, v.format, v.path, v.width, v.height,
	       pv.format, pv.path, pv.width, pv.height
	FROM assets a
	LEFT JOIN derivatives t  ON t.asset_id = a.id AND t.kind = 'thumb'
	LEFT JOIN derivatives p  ON p.asset_id = a.id AND p.kind = 'poster'
	LEFT JOIN thumb_variants v ON v.asset_id = a.id AND v.edge = ?
	LEFT JOIN derivatives pv ON pv.asset_id = a.id AND pv.kind = 'preview'
	WHERE a.id = ? AND a.owner_id = ? AND a.deleted_at IS NULL`

func (s *Service) load(ctx context.Context, ownerID, assetID string, edge int) (assetState, error) {
	var st assetState
	err := s.DB.QueryRowContext(ctx, stateSQL, edge, assetID, ownerID).Scan(
		&st.mediaType, &st.originalPath, &st.externalPath, &st.gen, &st.width, &st.height,
		&st.thumbFormat, &st.thumbPath, &st.thumbW, &st.thumbH,
		&st.posterFormat, &st.posterPath,
		&st.variantGen, &st.variantFormat, &st.variantPath, &st.variantW, &st.variantH,
		&st.previewFormat, &st.previewPath, &st.previewW, &st.previewH)
	if errors.Is(err, sql.ErrNoRows) {
		return st, ErrNotFound
	}
	if err != nil {
		return st, fmt.Errorf("thumbs: load asset %s: %w", assetID, err)
	}
	return st, nil
}

func (st assetState) medium(assetID string) (Variant, bool) {
	format, rel := st.thumbFormat, st.thumbPath
	w, h := st.thumbW.Int64, st.thumbH.Int64
	if !rel.Valid {
		format, rel, w, h = st.posterFormat, st.posterPath, 0, 0
	}
	if !rel.Valid {
		return Variant{}, false
	}
	return Variant{
		Rel: "derivatives/" + rel.String, ContentType: ContentType(format.String), Format: format.String,
		Version: Version(assetID, st.gen, format.String), Width: int(w), Height: int(h),
	}, true
}

// Get returns the servable file for tier, rendering it at most once per
// (asset, edge, generation) across concurrent callers.
func (s *Service) Get(ctx context.Context, ownerID, assetID string, tier Tier) (Variant, error) {
	s.init()
	edge := edgeFor(tier, s.MediumEdge)
	st, err := s.load(ctx, ownerID, assetID, edge)
	if err != nil {
		return Variant{}, err
	}
	medium, ok := st.medium(assetID)
	if !ok {
		return Variant{}, ErrNoSource
	}
	if edge == 0 || s.Media == nil {
		s.hits.Add(1)
		return medium, nil
	}
	if st.variantPath.Valid && int(st.variantGen.Int64) == st.gen {
		s.hits.Add(1)
		return Variant{
			Rel: "derivatives/" + st.variantPath.String, ContentType: ContentType(st.variantFormat.String),
			Format: st.variantFormat.String, Version: medium.Version,
			Width: int(st.variantW.Int64), Height: int(st.variantH.Int64),
		}, nil
	}

	key := fmt.Sprintf("%s:%d:%d", assetID, edge, st.gen)
	// The flight must outlive the first caller: a scrolled-away tile should not
	// throw away work the next request for the same tile is about to need.
	flightCtx := context.WithoutCancel(ctx)
	ch := s.sf.DoChan(key, func() (any, error) {
		return s.render(flightCtx, assetID, edge, st, medium)
	})
	select {
	case <-ctx.Done():
		return Variant{}, ctx.Err()
	case res := <-ch:
		if res.Shared {
			s.coalesced.Add(1)
		}
		switch {
		case res.Err == nil:
			return res.Val.(Variant), nil
		case errors.Is(res.Err, media.ErrUnsupported):
			return medium, nil
		case errors.Is(res.Err, ErrBusy):
			s.busy.Add(1)
		default:
			s.errs.Add(1)
		}
		return Variant{}, res.Err
	}
}

func (s *Service) render(ctx context.Context, assetID string, edge int, st assetState, medium Variant) (Variant, error) {
	ctx, cancel := context.WithTimeout(ctx, flightTimeout)
	defer cancel()

	if s.waiting.Add(1) > int64(s.MaxQueue) {
		s.waiting.Add(-1)
		return Variant{}, ErrBusy
	}
	select {
	case s.sem <- struct{}{}:
		s.waiting.Add(-1)
	case <-ctx.Done():
		s.waiting.Add(-1)
		return Variant{}, fmt.Errorf("thumbs: wait for worker: %w", ctx.Err())
	}
	defer func() { <-s.sem }()
	s.inflight.Add(1)
	defer s.inflight.Add(-1)
	started := time.Now()

	src, cleanup, err := s.source(ctx, st, medium)
	if err != nil {
		return Variant{}, err
	}
	defer cleanup()

	var buf bytes.Buffer
	if err := s.Media.Thumbnail(ctx, src, edge, &buf); err != nil {
		return Variant{}, fmt.Errorf("thumbs: render %s at %d: %w", assetID, edge, err)
	}
	format, ext := Format(s.Media)
	rel := PathFor(assetID, fmt.Sprintf("thumb_%d", edge), st.gen, ext)
	if _, err := s.Store.Write(ctx, rel, &buf); err != nil && !errors.Is(err, storage.ErrExists) {
		return Variant{}, fmt.Errorf("thumbs: write %s: %w", rel, err)
	}
	srcW, srcH := st.width, st.height
	if st.mediaType == string(domain.MediaVideo) && medium.Width > 0 {
		srcW, srcH = medium.Width, medium.Height
	}
	w, h := FitWithin(srcW, srcH, edge)
	if err := s.upsertVariant(ctx, assetID, edge, st.gen, format, strings.TrimPrefix(rel, "derivatives/"), w, h); err != nil {
		return Variant{}, err
	}
	s.generated.Add(1)
	s.generateNanos.Add(int64(time.Since(started)))
	return Variant{Rel: rel, ContentType: ContentType(format), Format: format, Version: medium.Version, Width: w, Height: h}, nil
}

// upsertVariant records a rendered tier. A render for an older generation can
// finish after a rebuild; the WHERE clause stops it replacing the newer row.
func (s *Service) upsertVariant(ctx context.Context, assetID string, edge, gen int, format, rel string, w, h int) error {
	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO thumb_variants (asset_id, edge, gen, format, path, width, height)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(asset_id, edge) DO UPDATE SET
			gen = excluded.gen, format = excluded.format, path = excluded.path,
			width = excluded.width, height = excluded.height,
			created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE excluded.gen >= thumb_variants.gen`,
		assetID, edge, gen, format, rel, w, h)
	if err != nil {
		return fmt.Errorf("thumbs: record variant %s at %d: %w", assetID, edge, err)
	}
	return nil
}

// source picks the file to downscale: the original for images (external
// libraries read in place), the medium poster for videos — never the video itself.
func (s *Service) source(ctx context.Context, st assetState, medium Variant) (string, func(), error) {
	if st.mediaType == string(domain.MediaVideo) {
		return s.localFile(ctx, medium.Rel)
	}
	if st.externalPath.Valid && st.externalPath.String != "" {
		return st.externalPath.String, func() {}, nil
	}
	return s.localFile(ctx, "originals/"+st.originalPath)
}

func (s *Service) localFile(ctx context.Context, rel string) (string, func(), error) {
	if lp, ok := s.Store.(storage.LocalPather); ok {
		p, err := lp.LocalPath(rel)
		if err != nil {
			return "", nil, fmt.Errorf("thumbs: resolve %s: %w", rel, err)
		}
		return p, func() {}, nil
	}
	rc, err := s.Store.Open(ctx, rel)
	if err != nil {
		return "", nil, fmt.Errorf("thumbs: open %s: %w", rel, err)
	}
	defer rc.Close()
	tmp, err := os.CreateTemp("", "kuraki-thumb-*"+path.Ext(rel))
	if err != nil {
		return "", nil, fmt.Errorf("thumbs: temp file: %w", err)
	}
	name := tmp.Name()
	_, copyErr := io.Copy(tmp, rc)
	closeErr := tmp.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		os.Remove(name)
		return "", nil, fmt.Errorf("thumbs: copy %s: %w", rel, err)
	}
	return name, func() { os.Remove(name) }, nil
}

// Preview returns the owner's preview/playback derivative with its URL version.
func (s *Service) Preview(ctx context.Context, ownerID, assetID string) (Variant, error) {
	st, err := s.load(ctx, ownerID, assetID, 0)
	if err != nil {
		return Variant{}, err
	}
	if !st.previewPath.Valid {
		return Variant{}, ErrNoSource
	}
	format := st.previewFormat.String
	return Variant{
		Rel: "derivatives/" + st.previewPath.String, ContentType: ContentType(format), Format: format,
		Version: Version(assetID, st.gen, format), Width: int(st.previewW.Int64), Height: int(st.previewH.Int64),
	}, nil
}
