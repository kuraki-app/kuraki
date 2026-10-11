package storage

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
)

type LegacyTrashLister interface {
	LegacyTrashPaths(context.Context) ([]string, error)
}

// LegacyTrashPaths scans only the older trash layout, so ordinary startup does
// not stat every original in an already-reconciled library.
func (f *FS) LegacyTrashPaths(ctx context.Context) ([]string, error) {
	root, err := f.resolve("trash")
	if err != nil {
		return nil, err
	}
	var paths []string
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) && path == root {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			paths = append(paths, filepath.ToSlash(rel))
		}
		return nil
	})
	return paths, err
}
