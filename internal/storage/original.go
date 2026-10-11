package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Original centralizes the read-only source policy for imported and indexed
// assets. External files must never resolve into Kuraki's managed storage.
type Original struct {
	Path         string
	ExternalPath string
}

func (o Original) externalLocalPath(store Storage) (string, error) {
	info, err := os.Lstat(o.ExternalPath)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("storage: external original is not a regular file")
	}
	real, err := filepath.EvalSymlinks(o.ExternalPath)
	if err != nil {
		return "", err
	}
	if local, ok := store.(LocalPather); ok {
		base, err := local.LocalPath(".")
		if err != nil {
			return "", err
		}
		base, err = filepath.EvalSymlinks(base)
		if err != nil {
			return "", err
		}
		rel, err := filepath.Rel(base, real)
		if err != nil {
			return "", err
		}
		if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
			return "", fmt.Errorf("storage: external original resolves into managed storage")
		}
	}
	return real, nil
}

func (o Original) Open(ctx context.Context, store Storage) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if o.ExternalPath != "" {
		path, err := o.externalLocalPath(store)
		if err != nil {
			return nil, err
		}
		root, err := os.OpenRoot(filepath.Dir(path))
		if err != nil {
			return nil, err
		}
		defer root.Close()
		return root.Open(filepath.Base(path))
	}
	return store.Open(ctx, "originals/"+o.Path)
}

func (o Original) LocalPath(store Storage) (string, error) {
	if o.ExternalPath != "" {
		return o.externalLocalPath(store)
	}
	if local, ok := store.(LocalPather); ok {
		return local.LocalPath("originals/" + o.Path)
	}
	return "", fmt.Errorf("storage: original has no local path")
}
