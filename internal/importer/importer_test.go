package importer

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func TestRunImportsImageAndSkipsUnchangedRerun(t *testing.T) {
	ctx := context.Background()
	runner, database, dataDir := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "IMG_0001.jpg"))

	result, err := runner.Run(ctx, Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Scanned != 1 || result.Imported != 1 || result.Skipped != 0 || len(result.Errors) != 0 {
		t.Fatalf("result = %+v, want one clean import", result)
	}

	var originalPath string
	var width, height int
	if err := database.QueryRowContext(ctx,
		`SELECT original_path, width, height FROM assets`).Scan(&originalPath, &width, &height); err != nil {
		t.Fatalf("asset row: %v", err)
	}
	if width != 12 || height != 8 {
		t.Fatalf("dimensions = %dx%d, want 12x8", width, height)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "originals", filepath.FromSlash(originalPath))); err != nil {
		t.Fatalf("original not written: %v", err)
	}
	assertCount(t, ctx, database, "assets", 1)
	assertCount(t, ctx, database, "assets_fts", 1)
	assertCount(t, ctx, database, "change_log", 1)
	assertCount(t, ctx, database, "import_state", 1)
	assertCount(t, ctx, database, "derivatives", 1)
	var thumbPath string
	if err := database.QueryRowContext(ctx, `SELECT path FROM derivatives WHERE kind = 'thumb'`).Scan(&thumbPath); err != nil {
		t.Fatalf("thumb row: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "derivatives", filepath.FromSlash(thumbPath))); err != nil {
		t.Fatalf("thumb not written: %v", err)
	}

	result, err = runner.Run(ctx, Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if result.Imported != 0 || result.Skipped != 1 || result.Duplicates != 0 {
		t.Fatalf("rerun result = %+v, want unchanged skip", result)
	}
	assertCount(t, ctx, database, "assets", 1)
	assertCount(t, ctx, database, "derivatives", 1)
}

func TestRunSkipsDuplicateBytes(t *testing.T) {
	ctx := context.Background()
	runner, database, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	first := filepath.Join(sourceDir, "a.jpg")
	second := filepath.Join(sourceDir, "nested", "b.jpg")
	writeJPEG(t, first)
	if err := os.MkdirAll(filepath.Dir(second), 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, bytes, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := runner.Run(ctx, Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Scanned != 2 || result.Imported != 1 || result.Skipped != 1 || result.Duplicates != 1 {
		t.Fatalf("result = %+v, want one import and one duplicate skip", result)
	}
	assertCount(t, ctx, database, "assets", 1)
	assertCount(t, ctx, database, "import_state", 2)
}

func TestRunDryRunDoesNotWrite(t *testing.T) {
	ctx := context.Background()
	runner, database, dataDir := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "dry.jpg"))

	result, err := runner.Run(ctx, Options{SourceDir: sourceDir, DryRun: true})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Scanned != 1 || result.Imported != 1 || result.Skipped != 0 || len(result.Errors) != 0 {
		t.Fatalf("result = %+v, want one dry-run candidate", result)
	}
	assertCount(t, ctx, database, "users", 0)
	assertCount(t, ctx, database, "assets", 0)
	assertCount(t, ctx, database, "import_state", 0)
	entries, err := os.ReadDir(filepath.Join(dataDir, "originals"))
	if err != nil {
		t.Fatalf("read originals: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("dry-run wrote originals: %d entries", len(entries))
	}
}

func TestRunClassifiesRenamedMediaAndRejectsDisguisedFiles(t *testing.T) {
	ctx := context.Background()
	runner, database, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "renamed.bin"))
	if err := os.WriteFile(filepath.Join(sourceDir, "not-a-photo.jpg"), []byte("plain text"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := runner.Run(ctx, Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 1 || len(result.Errors) != 1 {
		t.Fatalf("result = %+v, want one import and one content error", result)
	}
	var filename, mimeType string
	if err := database.QueryRowContext(ctx, `SELECT filename, mime_type FROM assets`).Scan(&filename, &mimeType); err != nil {
		t.Fatal(err)
	}
	if filename != "renamed.bin" || mimeType != "image/jpeg" {
		t.Fatalf("asset = filename %q mime %q, want renamed JPEG", filename, mimeType)
	}
}

func TestRunWritesProgress(t *testing.T) {
	ctx := context.Background()
	runner, _, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "progress.jpg"))

	var progress bytes.Buffer
	result, err := runner.Run(ctx, Options{
		SourceDir:        sourceDir,
		Progress:         &progress,
		ThumbnailWorkers: 1,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Imported != 1 {
		t.Fatalf("imported = %d, want 1", result.Imported)
	}
	output := progress.String()
	if !strings.Contains(output, "1/1") || !strings.Contains(output, "imported=1") {
		t.Fatalf("progress = %q, want import count", output)
	}
}

func TestRunCreatesCompatiblePlaybackForIncompatibleVideo(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ctx := context.Background()
	runner, database, dataDir := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	video := filepath.Join(sourceDir, "camera.mp4")
	if out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=32x24:rate=1", "-t", "1", "-c:v", "mpeg4", "-an", video).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg test fixture unavailable: %v (%s)", err, out)
	}
	result, err := runner.Run(ctx, Options{SourceDir: sourceDir, ThumbnailWorkers: 1})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("derivative errors = %+v", result.Errors)
	}
	var id, path, format string
	var duration int64
	var viewable int
	if err := database.QueryRowContext(ctx, `
		SELECT a.id, a.duration_ms, a.web_viewable, d.path, d.format
		FROM assets a JOIN derivatives d ON d.asset_id = a.id AND d.kind = 'preview'`).
		Scan(&id, &duration, &viewable, &path, &format); err != nil {
		t.Fatalf("playback derivative: %v", err)
	}
	if id == "" || duration <= 0 || viewable != 1 || format != "mp4" {
		t.Fatalf("asset playback state = id=%q duration=%d viewable=%d format=%q", id, duration, viewable, format)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "derivatives", filepath.FromSlash(path))); err != nil {
		t.Fatalf("playback derivative missing: %v", err)
	}
}

func newTestImporter(t *testing.T, ctx context.Context) (Importer, *sql.DB, string) {
	t.Helper()
	dataDir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store, err := storage.NewFS(dataDir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "originals"), 0o755); err != nil {
		t.Fatalf("create originals: %v", err)
	}
	return Importer{
		DB:    database,
		Store: store,
		Media: media.NewPureGo(),
	}, database, dataDir
}

func writeJPEG(t *testing.T, path string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 20), G: uint8(y * 30), B: 80, A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create jpeg: %v", err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
}

func assertCount(t *testing.T, ctx context.Context, database *sql.DB, table string, want int) {
	t.Helper()
	var got int
	if err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&got); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", table, got, want)
	}
}
