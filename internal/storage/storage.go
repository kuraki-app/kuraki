// Package storage abstracts file access behind an interface so domain logic
// never calls os.* directly. Phase 1 ships a plain-filesystem implementation;
// an S3 backend (F-34) can be added later without touching callers.
package storage

import (
	"context"
	"io"
)

// Storage is a content-addressed-friendly blob store keyed by relative path.
// Paths use forward slashes regardless of platform.
type Storage interface {
	// Write stores r at rel. If the path already exists it must NOT be
	// overwritten (originals are write-once, F-03); implementations return
	// ErrExists instead. Parent directories are created as needed.
	Write(ctx context.Context, rel string, r io.Reader) (int64, error)

	// Open returns a reader for rel. Caller closes it.
	Open(ctx context.Context, rel string) (io.ReadCloser, error)

	// Exists reports whether rel is present.
	Exists(ctx context.Context, rel string) (bool, error)

	// Size returns the byte length of rel.
	Size(ctx context.Context, rel string) (int64, error)

	// Move relocates a blob (used to send originals to trash, F-10).
	Move(ctx context.Context, srcRel, dstRel string) error

	// Remove deletes rel permanently (trash purge, F-10).
	Remove(ctx context.Context, rel string) error
}
