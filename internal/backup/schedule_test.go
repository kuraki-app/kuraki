package backup

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
)

func TestRunAndRecordAndLastRun(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	backupDir := t.TempDir()

	// A minimal but real library: a migrated database plus one original.
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "originals", "2026", "07"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "originals", "2026", "07", "p.jpg"), []byte("bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	summary, err := RunAndRecord(ctx, database, dataDir, backupDir)
	if err != nil {
		t.Fatalf("RunAndRecord: %v", err)
	}
	if summary.Status != "ok" {
		t.Fatalf("status = %q, want ok", summary.Status)
	}
	if summary.Bytes <= 0 {
		t.Fatalf("bytes = %d, want > 0", summary.Bytes)
	}
	if !strings.HasPrefix(filepath.Base(summary.Destination), backupPrefix) {
		t.Fatalf("archive name %q missing prefix", summary.Destination)
	}
	if _, err := os.Stat(summary.Destination); err != nil {
		t.Fatalf("archive not written: %v", err)
	}

	last, ok, err := LastRun(ctx, database)
	if err != nil || !ok {
		t.Fatalf("LastRun ok=%v err=%v", ok, err)
	}
	if last.Status != "ok" || last.FinishedAt == "" {
		t.Fatalf("LastRun = %+v, want finished ok run", last)
	}
}

func TestPruneKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	// Timestamped names sort chronologically; create five plus an unrelated file.
	names := []string{
		backupPrefix + "20260101T000000Z.tar.gz",
		backupPrefix + "20260102T000000Z.tar.gz",
		backupPrefix + "20260103T000000Z.tar.gz",
		backupPrefix + "20260104T000000Z.tar.gz",
		backupPrefix + "20260105T000000Z.tar.gz",
	}
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// An unrelated file must never be pruned.
	if err := os.WriteFile(filepath.Join(dir, "keep-me.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Prune(dir, 2); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	remaining := map[string]bool{}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		remaining[e.Name()] = true
	}
	if len(remaining) != 3 { // 2 newest archives + the unrelated file
		t.Fatalf("remaining = %v, want 3 entries", remaining)
	}
	if !remaining[names[3]] || !remaining[names[4]] {
		t.Fatalf("newest two archives should survive: %v", remaining)
	}
	if remaining[names[0]] {
		t.Fatalf("oldest archive should have been pruned: %v", remaining)
	}
	if !remaining["keep-me.txt"] {
		t.Fatal("unrelated file must not be pruned")
	}
}
