package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

func TestFS_WriteOnceAndRead(t *testing.T) {
	ctx := context.Background()
	fs, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	const rel = "originals/2026/07/IMG_1234.jpg"
	want := []byte("photo-bytes")

	n, err := fs.Write(ctx, rel, bytes.NewReader(want))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if n != int64(len(want)) {
		t.Fatalf("wrote %d bytes, want %d", n, len(want))
	}

	// Write-once (F-03): a second write to the same path must be refused.
	if _, err := fs.Write(ctx, rel, bytes.NewReader([]byte("other"))); !errors.Is(err, ErrExists) {
		t.Fatalf("second write err = %v, want ErrExists", err)
	}

	rc, err := fs.Open(ctx, rel)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer rc.Close()
	got, _ := io.ReadAll(rc)
	if !bytes.Equal(got, want) {
		t.Fatalf("read %q, want %q", got, want)
	}
}

func TestFS_PathTraversalRejected(t *testing.T) {
	ctx := context.Background()
	fs, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Write(ctx, "../escape.txt", bytes.NewReader([]byte("x"))); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func TestFS_MoveAndExists(t *testing.T) {
	ctx := context.Background()
	fs, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Write(ctx, "a/x.jpg", bytes.NewReader([]byte("z"))); err != nil {
		t.Fatal(err)
	}
	if err := fs.Move(ctx, "a/x.jpg", "trash/x.jpg"); err != nil {
		t.Fatalf("move: %v", err)
	}
	if ok, _ := fs.Exists(ctx, "a/x.jpg"); ok {
		t.Fatal("source should no longer exist after move")
	}
	if ok, _ := fs.Exists(ctx, "trash/x.jpg"); !ok {
		t.Fatal("destination should exist after move")
	}
}
