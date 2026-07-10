package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
)

func TestCreateRestoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	target := t.TempDir()
	archive := filepath.Join(t.TempDir(), "library.tar.gz")
	if err := os.MkdirAll(filepath.Join(source, "originals", "2026", "07"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "originals", "2026", "07", "photo.jpg"), []byte("original bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "kuraki.db"), []byte("database bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(source, "staging"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "staging", "temporary"), []byte("skip"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Create(ctx, source, archive); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := Restore(ctx, archive, target); err != nil {
		t.Fatalf("restore: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(target, "originals", "2026", "07", "photo.jpg"))
	if err != nil || string(got) != "original bytes" {
		t.Fatalf("original=%q err=%v", got, err)
	}
	if _, err := os.Stat(filepath.Join(target, "staging")); !os.IsNotExist(err) {
		t.Fatalf("staging should be excluded, err=%v", err)
	}
}

func TestCreateLiveSnapshotsDatabaseBeforeArchivingFiles(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(source, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.ExecContext(ctx, `CREATE TABLE backup_probe (value TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO backup_probe (value) VALUES ('snapshot')`); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(source, "originals"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "originals", "photo.jpg"), []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "library.tar.gz")
	if err := CreateLive(ctx, database, source, archive); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO backup_probe (value) VALUES ('after')`); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	if err := Restore(ctx, archive, target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "kuraki.db-wal")); !os.IsNotExist(err) {
		t.Fatalf("live WAL should not be archived, err=%v", err)
	}
	restored, err := db.Open(ctx, filepath.Join(target, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var count int
	if err := restored.QueryRowContext(ctx, `SELECT COUNT(*) FROM backup_probe`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("restored probe rows = %d, want 1 consistent snapshot row", count)
	}
}

func TestRestoreLeavesTargetUntouchedWhenManifestIsMissing(t *testing.T) {
	ctx := context.Background()
	archive := filepath.Join(t.TempDir(), "missing-manifest.tar.gz")
	writeArchive(t, archive, []archiveEntry{{name: "originals/photo.jpg", data: []byte("original")}}, nil)
	target := t.TempDir()

	if err := Restore(ctx, archive, target); err == nil {
		t.Fatal("Restore succeeded without a manifest")
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("target has %d entries after failed restore, want 0", len(entries))
	}
}

func TestRestoreRejectsManifestMismatchWithoutPartialLibrary(t *testing.T) {
	ctx := context.Background()
	archive := filepath.Join(t.TempDir(), "mismatch.tar.gz")
	manifest := &Manifest{Format: currentFormat, FileCount: 2, TotalBytes: 99}
	writeArchive(t, archive, []archiveEntry{{name: "originals/photo.jpg", data: []byte("original")}}, manifest)
	target := t.TempDir()

	if err := Restore(ctx, archive, target); err == nil {
		t.Fatal("Restore succeeded with a mismatched manifest")
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("target has %d entries after failed restore, want 0", len(entries))
	}
}

type archiveEntry struct {
	name string
	data []byte
}

func writeArchive(t *testing.T, destination string, entries []archiveEntry, manifest *Manifest) {
	t.Helper()
	f, err := os.Create(destination)
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(f)
	tw := tar.NewWriter(zw)
	for _, entry := range entries {
		if err := tw.WriteHeader(&tar.Header{Name: entry.name, Mode: 0o600, Size: int64(len(entry.data))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if manifest != nil {
		data, err := json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		if err := tw.WriteHeader(&tar.Header{Name: manifestName, Mode: 0o600, Size: int64(len(data))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreRequiresEmptyTarget(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	archive := filepath.Join(t.TempDir(), "library.tar.gz")
	if err := os.WriteFile(filepath.Join(source, "kuraki.db"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Create(ctx, source, archive); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(target, "existing"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(ctx, archive, target); err == nil {
		t.Fatal("restore should reject nonempty target")
	}
}
