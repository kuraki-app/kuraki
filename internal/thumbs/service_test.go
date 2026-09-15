package thumbs

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

type fixture struct {
	ctx   context.Context
	db    *sql.DB
	store *storage.FS
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dir, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	f := fixture{ctx: ctx, db: database, store: store}
	f.exec(t, `INSERT INTO users (id, username, password_hash) VALUES ('u1','owner',''), ('u2','other','')`)
	return f
}

func (f fixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.db.ExecContext(f.ctx, query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

// addImage stores a byte-distinct 64×48 JPEG original plus its medium thumb.
func (f fixture) addImage(t *testing.T, id string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for i := range img.Pix {
		img.Pix[i] = uint8(i*7 + len(id)*31 + int(id[len(id)-1]))
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"originals/2026/09/" + id + ".jpg", "derivatives/" + id + "/thumb_512_g0.jpg"} {
		if _, err := f.store.Write(f.ctx, rel, bytes.NewReader(buf.Bytes())); err != nil {
			t.Fatal(err)
		}
	}
	f.exec(t, `INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type, width, height)
		VALUES (?, 'u1', ?, ?, ?, 'image/jpeg', 'image', 64, 48)`, id, "hash-"+id, "2026/09/"+id+".jpg", id+".jpg")
	f.exec(t, `INSERT INTO derivatives (asset_id, kind, format, path, width, height) VALUES (?, 'thumb', 'jpeg', ?, 64, 48)`,
		id, id+"/thumb_512_g0.jpg")
}

type gatedProcessor struct {
	media.Processor
	calls   atomic.Int32
	active  atomic.Int32
	peak    atomic.Int32
	release chan struct{}
}

func (p *gatedProcessor) Thumbnail(ctx context.Context, src string, edge int, dst io.Writer) error {
	p.calls.Add(1)
	n := p.active.Add(1)
	defer p.active.Add(-1)
	for {
		old := p.peak.Load()
		if n <= old || p.peak.CompareAndSwap(old, n) {
			break
		}
	}
	if p.release != nil {
		select {
		case <-p.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return p.Processor.Thumbnail(ctx, src, edge, dst)
}

type unsupportedProcessor struct{ media.Processor }

func (unsupportedProcessor) Thumbnail(context.Context, string, int, io.Writer) error {
	return media.ErrUnsupported
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met within 3s")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func newService(f fixture, p media.Processor, workers, queue int) *Service {
	return &Service{DB: f.db, Store: f.store, Media: p, MediumEdge: 512, Workers: workers, MaxQueue: queue}
}

func TestGetMediumServesImportedThumb(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	v, err := newService(f, nil, 1, 1).Get(f.ctx, "u1", "a1", TierMedium)
	if err != nil {
		t.Fatal(err)
	}
	if v.Rel != "derivatives/a1/thumb_512_g0.jpg" || v.ContentType != "image/jpeg" || v.Version != Version("a1", 0, "jpeg") {
		t.Fatalf("variant = %+v", v)
	}
}

func TestGetIsOwnerAndTrashScoped(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	s := newService(f, media.NewPureGo(), 1, 4)
	if _, err := s.Get(f.ctx, "u2", "a1", TierLarge); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner err = %v, want ErrNotFound", err)
	}
	f.exec(t, `UPDATE assets SET deleted_at = '2026-09-15T00:00:00Z' WHERE id = 'a1'`)
	if _, err := s.Get(f.ctx, "u1", "a1", TierMedium); !errors.Is(err, ErrNotFound) {
		t.Fatalf("trashed err = %v, want ErrNotFound", err)
	}
}

func TestGetRendersVariantOnceUnderConcurrency(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	p := &gatedProcessor{Processor: media.NewPureGo(), release: make(chan struct{})}
	s := newService(f, p, 2, 64)

	var wg sync.WaitGroup
	results := make([]Variant, 16)
	errs := make([]error, 16)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = s.Get(f.ctx, "u1", "a1", TierLarge)
		}()
	}
	waitFor(t, func() bool { return p.calls.Load() == 1 })
	time.Sleep(100 * time.Millisecond) // let the other callers join the flight
	close(p.release)
	wg.Wait()

	if got := p.calls.Load(); got != 1 {
		t.Fatalf("renders = %d, want 1", got)
	}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: %v", i, err)
		}
		if results[i].Rel != "derivatives/a1/thumb_1200_g0.jpg" {
			t.Fatalf("caller %d rel = %q", i, results[i].Rel)
		}
	}
	if ok, _ := f.store.Exists(f.ctx, "derivatives/a1/thumb_1200_g0.jpg"); !ok {
		t.Fatal("variant file not written")
	}
	// A later call is a DB hit with no render.
	if _, err := s.Get(f.ctx, "u1", "a1", TierLarge); err != nil || p.calls.Load() != 1 {
		t.Fatalf("second call err=%v renders=%d", err, p.calls.Load())
	}
}

func TestCancelledCallerDoesNotCancelRender(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	p := &gatedProcessor{Processor: media.NewPureGo(), release: make(chan struct{})}
	s := newService(f, p, 1, 4)

	ctx, cancel := context.WithCancel(f.ctx)
	done := make(chan error, 1)
	go func() {
		_, err := s.Get(ctx, "u1", "a1", TierSmall)
		done <- err
	}()
	waitFor(t, func() bool { return p.calls.Load() == 1 })
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller err = %v", err)
	}
	close(p.release)
	waitFor(t, func() bool {
		var n int
		_ = f.db.QueryRow(`SELECT COUNT(*) FROM thumb_variants WHERE asset_id = 'a1' AND edge = 256`).Scan(&n)
		return n == 1
	})
}

func TestWorkersBoundConcurrentRenders(t *testing.T) {
	f := newFixture(t)
	ids := []string{"a1", "a2", "a3", "a4", "a5", "a6"}
	for _, id := range ids {
		f.addImage(t, id)
	}
	p := &gatedProcessor{Processor: media.NewPureGo(), release: make(chan struct{})}
	s := newService(f, p, 2, 64)

	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Get(f.ctx, "u1", id, TierLarge); err != nil {
				t.Errorf("%s: %v", id, err)
			}
		}()
	}
	waitFor(t, func() bool { return p.calls.Load() == 2 })
	time.Sleep(100 * time.Millisecond)
	close(p.release)
	wg.Wait()
	if peak := p.peak.Load(); peak > 2 {
		t.Fatalf("peak concurrent renders = %d, want <= 2", peak)
	}
	if calls := p.calls.Load(); calls != 6 {
		t.Fatalf("renders = %d, want 6", calls)
	}
}

func TestQueueOverflowReturnsBusy(t *testing.T) {
	f := newFixture(t)
	for _, id := range []string{"a1", "a2", "a3"} {
		f.addImage(t, id)
	}
	p := &gatedProcessor{Processor: media.NewPureGo(), release: make(chan struct{})}
	s := newService(f, p, 1, 1)
	defer close(p.release)

	go func() { _, _ = s.Get(f.ctx, "u1", "a1", TierLarge) }()
	waitFor(t, func() bool { return p.calls.Load() == 1 })
	go func() { _, _ = s.Get(f.ctx, "u1", "a2", TierLarge) }()
	waitFor(t, func() bool { return s.waiting.Load() == 1 })

	if _, err := s.Get(f.ctx, "u1", "a3", TierLarge); !errors.Is(err, ErrBusy) {
		t.Fatalf("overflow err = %v, want ErrBusy", err)
	}
	if s.Snapshot().Busy != 1 {
		t.Fatalf("busy metric = %d, want 1", s.Snapshot().Busy)
	}
}

func TestStaleGenerationCannotOverwriteNewer(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	s := newService(f, media.NewPureGo(), 1, 4)
	f.exec(t, `INSERT INTO thumb_variants (asset_id, edge, gen, format, path) VALUES ('a1', 1200, 2, 'jpeg', 'a1/thumb_1200_g2.jpg')`)
	if err := s.upsertVariant(f.ctx, "a1", 1200, 1, "jpeg", "a1/thumb_1200_g1.jpg", 64, 48); err != nil {
		t.Fatal(err)
	}
	var gen int
	var path string
	if err := f.db.QueryRow(`SELECT gen, path FROM thumb_variants WHERE asset_id = 'a1' AND edge = 1200`).Scan(&gen, &path); err != nil {
		t.Fatal(err)
	}
	if gen != 2 || path != "a1/thumb_1200_g2.jpg" {
		t.Fatalf("row = gen %d %q, want the newer generation kept", gen, path)
	}
}

func TestRedundantTierServedFromMedium(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	p := &gatedProcessor{Processor: media.NewPureGo()}
	s := newService(f, p, 1, 4)
	s.MediumEdge = 1200
	v, err := s.Get(f.ctx, "u1", "a1", TierLarge)
	if err != nil || v.Rel != "derivatives/a1/thumb_512_g0.jpg" || p.calls.Load() != 0 {
		t.Fatalf("variant=%+v err=%v renders=%d; want medium, no render", v, err, p.calls.Load())
	}
}

func TestUnsupportedDecoderFallsBackToMedium(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	s := newService(f, unsupportedProcessor{media.NewPureGo()}, 1, 4)
	v, err := s.Get(f.ctx, "u1", "a1", TierLarge)
	if err != nil || v.Rel != "derivatives/a1/thumb_512_g0.jpg" {
		t.Fatalf("variant=%+v err=%v; want medium fallback", v, err)
	}
}

func TestPreviewVersioned(t *testing.T) {
	f := newFixture(t)
	f.addImage(t, "a1")
	s := newService(f, nil, 1, 1)
	if _, err := s.Preview(f.ctx, "u1", "a1"); !errors.Is(err, ErrNoSource) {
		t.Fatalf("no preview err = %v, want ErrNoSource", err)
	}
	f.exec(t, `INSERT INTO derivatives (asset_id, kind, format, path) VALUES ('a1', 'preview', 'webp', 'a1/preview_g0.webp')`)
	v, err := s.Preview(f.ctx, "u1", "a1")
	if err != nil || v.Rel != "derivatives/a1/preview_g0.webp" || v.ContentType != "image/webp" || v.Version != Version("a1", 0, "webp") {
		t.Fatalf("preview = %+v, %v", v, err)
	}
}
