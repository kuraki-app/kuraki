package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrExists is returned by Write when the target path already holds a blob.
// Originals are write-once (F-03), so callers treat this as "already stored".
var ErrExists = errors.New("storage: blob already exists")

// FS is a filesystem Storage rooted at Base. All relative paths are
// cleaned and confined to Base to prevent traversal.
type FS struct {
	Base string
}

// NewFS returns an FS rooted at base, creating the directory if needed.
func NewFS(base string) (*FS, error) {
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, fmt.Errorf("storage: create base: %w", err)
	}
	return &FS{Base: base}, nil
}

// resolve turns a slash-separated relative path into a confined absolute path,
// explicitly rejecting absolute paths and any that escape the base via "..".
func (f *FS) resolve(rel string) (string, error) {
	p := filepath.FromSlash(rel)
	if p == "" {
		return "", fmt.Errorf("storage: empty path")
	}
	clean := filepath.Clean(p)
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("storage: path escapes base: %q", rel)
	}
	return filepath.Join(f.Base, clean), nil
}

func (f *FS) Write(ctx context.Context, rel string, r io.Reader) (int64, error) {
	full, err := f.resolve(rel)
	if err != nil {
		return 0, err
	}
	if _, err := os.Stat(full); err == nil {
		return 0, ErrExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return 0, err
	}
	// Write to a temp file then rename for atomicity / crash-safety.
	tmp, err := os.CreateTemp(filepath.Dir(full), ".kuraki-*.tmp")
	if err != nil {
		return 0, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	n, err := io.Copy(tmp, r)
	if err != nil {
		tmp.Close()
		return 0, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return 0, err
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if err := os.Rename(tmpName, full); err != nil {
		return 0, err
	}
	return n, nil
}

func (f *FS) Open(ctx context.Context, rel string) (io.ReadCloser, error) {
	full, err := f.resolve(rel)
	if err != nil {
		return nil, err
	}
	return os.Open(full)
}

func (f *FS) Exists(ctx context.Context, rel string) (bool, error) {
	full, err := f.resolve(rel)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(full)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func (f *FS) Size(ctx context.Context, rel string) (int64, error) {
	full, err := f.resolve(rel)
	if err != nil {
		return 0, err
	}
	fi, err := os.Stat(full)
	if err != nil {
		return 0, err
	}
	return fi.Size(), nil
}

func (f *FS) Move(ctx context.Context, srcRel, dstRel string) error {
	src, err := f.resolve(srcRel)
	if err != nil {
		return err
	}
	dst, err := f.resolve(dstRel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

func (f *FS) Remove(ctx context.Context, rel string) error {
	full, err := f.resolve(rel)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// compile-time check
var _ Storage = (*FS)(nil)
