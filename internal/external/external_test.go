package external

import (
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/media"
)

func TestScanIndexesWithoutCopyingOriginal(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(data, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO users(id,username,password_hash) VALUES('owner','owner','hash')`); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	path := filepath.Join(root, "external.jpg")
	writeJPEG(t, path)
	if _, err := database.ExecContext(ctx, `INSERT INTO external_libraries(id,owner_id,name,root_path) VALUES('lib','owner','External',?)`, root); err != nil {
		t.Fatal(err)
	}
	result, err := Scan(ctx, database, media.NewPureGo(), "lib", "owner", root)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scanned != 1 || result.Indexed != 1 {
		t.Fatalf("result=%+v", result)
	}
	var stored string
	if err := database.QueryRowContext(ctx, `SELECT external_path FROM assets WHERE external_library_id='lib'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != path {
		t.Fatalf("path=%q want %q", stored, path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("source was changed: %v", err)
	}
	result, err = Scan(ctx, database, media.NewPureGo(), "lib", "owner", root)
	if err != nil {
		t.Fatal(err)
	}
	if result.Indexed != 0 || result.Skipped != 1 {
		t.Fatalf("rescan=%+v", result)
	}
}
func writeJPEG(t *testing.T, path string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatal(err)
	}
}
