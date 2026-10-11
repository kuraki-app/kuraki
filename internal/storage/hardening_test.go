package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLibraryLockCoordinatesIndependentHandles(t *testing.T) {
	root := t.TempDir()
	a, err := NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	readA, err := a.LockLibrary(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	readB, err := b.LockLibrary(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if unlock, err := b.LockLibrary(ctx, true); !errors.Is(err, context.DeadlineExceeded) {
		if unlock != nil {
			unlock()
		}
		t.Fatalf("destructive lock bypassed readers: %v", err)
	}
	readA()
	readB()
	unlock, err := b.LockLibrary(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestOriginalSourcesExcludeManagedStorageAndSymlinks(t *testing.T) {
	store, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(context.Background(), "originals/private.jpg", strings.NewReader("private")); err != nil {
		t.Fatal(err)
	}
	managed, _ := store.LocalPath("originals/private.jpg")
	if _, err := (Original{ExternalPath: managed}).Open(context.Background(), store); err == nil {
		t.Fatal("external path entered managed storage")
	}
	external := filepath.Join(t.TempDir(), "external.jpg")
	if err := os.WriteFile(external, []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	rc, err := (Original{ExternalPath: external}).Open(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := io.ReadAll(rc)
	rc.Close()
	if err != nil || string(bytes) != "external" {
		t.Fatalf("read source=%q err=%v", bytes, err)
	}
	link := filepath.Join(t.TempDir(), "linked.jpg")
	if err := os.Symlink(external, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := (Original{ExternalPath: link}).Open(context.Background(), store); err == nil {
		t.Fatal("external file symlink followed")
	}
}
