package queue

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
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

func jpegBytes(t *testing.T, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for x := 0; x < 32; x++ {
		for y := 0; y < 32; y++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func multipartFiles(t *testing.T, name string, contents ...[]byte) []*multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for _, content := range contents {
		part, err := w.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/assets", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	return req.MultipartForm.File["file"]
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

func TestEnqueueUploadPreservesDuplicateFilenames(t *testing.T) {
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
	q, err := New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"),
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}

	files := multipartFiles(t, "IMG_0001.jpg",
		jpegBytes(t, color.RGBA{255, 0, 0, 255}),
		jpegBytes(t, color.RGBA{0, 0, 255, 255}),
	)
	jobID, err := q.EnqueueUpload(ctx, "owner", files)
	if err != nil {
		t.Fatal(err)
	}
	var source string
	if err := database.QueryRowContext(ctx, `SELECT source FROM jobs WHERE id = ?`, jobID).Scan(&source); err != nil {
		t.Fatal(err)
	}
	staged, err := os.ReadDir(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(staged) != 2 || !staged[0].IsDir() || !staged[1].IsDir() {
		t.Fatalf("staged entries = %#v, want two directories", staged)
	}

	job, ok := q.claim(ctx)
	if !ok || job.ID != jobID {
		t.Fatalf("claim returned %q, %v", job.ID, ok)
	}
	q.process(ctx, job)
	var assets int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets`).Scan(&assets); err != nil {
		t.Fatal(err)
	}
	if assets != 2 {
		t.Fatalf("assets = %d, want 2", assets)
	}
}
