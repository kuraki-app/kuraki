package queue

import (
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func writeJPEG(t *testing.T, path string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for x := 0; x < 32; x++ {
		for y := 0; y < 32; y++ {
			img.Set(x, y, color.RGBA{uint8(x * 8), uint8(y * 8), 128, 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatal(err)
	}
}

func TestQueueProcess(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()

	database, err := db.Open(ctx, filepath.Join(root, "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(filepath.Join(root, "lib"))
	if err != nil {
		t.Fatal(err)
	}

	// A source directory with one image to import.
	src := filepath.Join(root, "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJPEG(t, filepath.Join(src, "pic.jpg"))

	q, err := New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"),
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := database.ExecContext(ctx, `
		INSERT INTO jobs (id, kind, owner, source, status, total, next_attempt_at)
		VALUES ('j1', 'import', 'owner', ?, 'queued', 1, '2000-01-01T00:00:00Z')`, src); err != nil {
		t.Fatal(err)
	}

	job, ok := q.claim(ctx)
	if !ok || job.ID != "j1" {
		t.Fatalf("claim returned %v, %v", job.ID, ok)
	}
	q.process(ctx, job)

	var status string
	var imported int
	if err := database.QueryRowContext(ctx,
		`SELECT status, imported FROM jobs WHERE id = 'j1'`).Scan(&status, &imported); err != nil {
		t.Fatal(err)
	}
	if status != "succeeded" || imported != 1 {
		t.Fatalf("job status=%q imported=%d, want succeeded/1", status, imported)
	}

	var assets int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets`).Scan(&assets); err != nil {
		t.Fatal(err)
	}
	if assets != 1 {
		t.Fatalf("assets = %d, want 1", assets)
	}
}
