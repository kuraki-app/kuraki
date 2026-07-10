package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
