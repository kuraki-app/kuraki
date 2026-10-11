package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
)

func TestRestoreRejectsMissingGzipTrailer(t *testing.T) {
	source := t.TempDir()
	writeTree(t, source)
	archive := filepath.Join(t.TempDir(), "archive.tar.gz")
	if err := Create(context.Background(), source, archive); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, bytes[:len(bytes)-8], 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "restored")
	if err := Restore(context.Background(), archive, target); err == nil {
		t.Fatal("truncated gzip was installed")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("invalid restore touched target: %v", err)
	}
}

func TestCreateLiveRejectsMissingReferencedOriginals(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(source, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO users(id,username,password_hash) VALUES ('owner','owner','hash')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO assets(id,owner_id,content_hash,original_path,filename,mime_type,media_type) VALUES ('asset','owner','hash','missing.jpg','missing.jpg','image/jpeg','image')`); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "archive.tar.gz")
	if err := CreateLive(ctx, database, source, archive); err == nil {
		t.Fatal("incomplete library was reported backed up")
	}
	if _, err := os.Stat(archive); !os.IsNotExist(err) {
		t.Fatalf("failed backup left published output: %v", err)
	}
}

func TestFailedBackupPreservesExistingArchive(t *testing.T) {
	source := t.TempDir()
	writeTree(t, source)
	archive := filepath.Join(t.TempDir(), "archive.tar.gz")
	if err := Create(context.Background(), source, archive); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Create(ctx, source, archive); err == nil {
		t.Fatal("cancelled backup succeeded")
	}
	after, err := os.ReadFile(archive)
	if err != nil || string(after) != string(before) {
		t.Fatalf("earlier archive was damaged: %v", err)
	}
}
