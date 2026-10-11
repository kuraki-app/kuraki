package importer

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// A processor may require a preview even when it can decode the source. Its
// original capability must not be inferred from a previously generated preview.
type needsPreviewProcessor struct{ media.Processor }

func (p needsPreviewProcessor) Probe(ctx context.Context, path string) (media.Meta, error) {
	meta, err := p.Processor.Probe(ctx, path)
	meta.WebViewable = false
	return meta, err
}

func TestRebuildRecreatesARequiredMissingPreview(t *testing.T) {
	ctx := context.Background()
	runner, database, data := newTestImporter(t, ctx)
	runner.Media = needsPreviewProcessor{runner.Media}
	source := t.TempDir()
	writeJPEG(t, filepath.Join(source, "photo.jpg"))
	result, err := runner.Run(ctx, Options{SourceDir: source})
	if err != nil || len(result.Errors) != 0 {
		t.Fatalf("import=%+v err=%v", result, err)
	}
	id := result.Assets[0].AssetID
	var preview string
	var viewable int
	if err := database.QueryRow(`SELECT d.path,a.web_viewable FROM derivatives d JOIN assets a ON a.id=d.asset_id WHERE d.asset_id=? AND d.kind='preview'`, id).Scan(&preview, &viewable); err != nil {
		t.Fatal(err)
	}
	if viewable != 1 {
		t.Fatal("preview did not make the asset viewable")
	}
	if err := os.Remove(filepath.Join(data, "derivatives", preview)); err != nil {
		t.Fatal(err)
	}
	if err := runner.RebuildDerivatives(ctx, id); err != nil {
		t.Fatal(err)
	}
	var rebuilt string
	if err := database.QueryRow(`SELECT path FROM derivatives WHERE asset_id=? AND kind='preview'`, id).Scan(&rebuilt); err != nil {
		t.Fatal(err)
	}
	if rebuilt == preview {
		t.Fatal("missing preview was not replaced")
	}
	if info, err := os.Stat(filepath.Join(data, "derivatives", rebuilt)); err != nil || info.Size() == 0 {
		t.Fatalf("rebuilt preview unavailable: %v", err)
	}
}

// Missing tool support must remain visible even if an older derivative row exists.
type unsupportedThumbnailProcessor struct{ media.Processor }

func (p unsupportedThumbnailProcessor) Thumbnail(context.Context, string, int, io.Writer) error {
	return media.ErrUnsupported
}
func TestRebuildPreservesUnsupportedDerivativeIssue(t *testing.T) {
	ctx := context.Background()
	runner, database, data := newTestImporter(t, ctx)
	source := t.TempDir()
	writeJPEG(t, filepath.Join(source, "photo.jpg"))
	result, err := runner.Run(ctx, Options{SourceDir: source})
	if err != nil || len(result.Errors) != 0 {
		t.Fatalf("import: %+v %v", result, err)
	}
	id := result.Assets[0].AssetID
	var path string
	if err := database.QueryRow(`SELECT path FROM derivatives WHERE asset_id=? AND kind='thumb'`, id).Scan(&path); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(data, "derivatives", path)); err != nil {
		t.Fatal(err)
	}
	runner.Media = unsupportedThumbnailProcessor{runner.Media}
	if err := runner.RebuildDerivatives(ctx, id); !errors.Is(err, media.ErrUnsupported) {
		t.Fatalf("unsupported rebuild: %v", err)
	}
	var issues int
	if err := database.QueryRow(`SELECT COUNT(*) FROM media_issues WHERE asset_id=? AND kind='thumbnail'`, id).Scan(&issues); err != nil || issues != 1 {
		t.Fatalf("missing health issue: %d %v", issues, err)
	}
}
func TestRebuildCannotRetireFilesDuringSnapshot(t *testing.T) {
	ctx := context.Background()
	runner, database, data := newTestImporter(t, ctx)
	source := t.TempDir()
	writeJPEG(t, filepath.Join(source, "photo.jpg"))
	result, err := runner.Run(ctx, Options{SourceDir: source})
	if err != nil || len(result.Errors) != 0 {
		t.Fatalf("import: %+v %v", result, err)
	}
	id := result.Assets[0].AssetID
	var path string
	if err := database.QueryRow(`SELECT path FROM derivatives WHERE asset_id=? AND kind='thumb'`, id).Scan(&path); err != nil {
		t.Fatal(err)
	}
	unlock, err := storage.LockLibrary(ctx, runner.Store, false)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			unlock()
		}
	}()
	short, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if err := runner.RebuildDerivatives(short, id); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("rebuild overlapped snapshot: %v", err)
	}
	if _, err := os.Stat(filepath.Join(data, "derivatives", path)); err != nil {
		t.Fatal(err)
	}
	unlock()
	held = false
	if err := runner.RebuildDerivatives(ctx, id); err != nil {
		t.Fatal(err)
	}
}
