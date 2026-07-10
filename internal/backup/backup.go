// Package backup creates and restores portable Kuraki library archives.
package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const manifestName = "kuraki-backup.json"

type Manifest struct {
	Format    int       `json:"format"`
	CreatedAt time.Time `json:"created_at"`
}

// Create archives all durable library data except transient staging and upgrade
// snapshots. Originals remain byte-for-byte unchanged in the archive.
func Create(ctx context.Context, dataDir, destination string) error {
	out, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("backup: create archive: %w", err)
	}
	defer out.Close()
	zw := gzip.NewWriter(out)
	defer zw.Close()
	tw := tar.NewWriter(zw)
	defer tw.Close()
	manifest, _ := json.Marshal(Manifest{Format: 1, CreatedAt: time.Now().UTC()})
	if err := tw.WriteHeader(&tar.Header{Name: manifestName, Mode: 0o600, Size: int64(len(manifest)), ModTime: time.Now()}); err != nil {
		return err
	}
	if _, err := tw.Write(manifest); err != nil {
		return err
	}
	return filepath.WalkDir(dataDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if rel == "staging" || strings.HasPrefix(rel, "staging"+string(os.PathSeparator)) || rel == "snapshots" || strings.HasPrefix(rel, "snapshots"+string(os.PathSeparator)) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		h := &tar.Header{Name: name, Mode: int64(info.Mode().Perm()), ModTime: info.ModTime()}
		if entry.IsDir() {
			h.Typeflag = tar.TypeDir
			return tw.WriteHeader(h)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		h.Size = info.Size()
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, f)
		closeErr := f.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}

// Restore expands an archive into an empty directory. It rejects traversal and
// incomplete archives before any durable library path is created.
func Restore(ctx context.Context, source, dataDir string) error {
	entries, err := os.ReadDir(dataDir)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("backup: inspect target: %w", err)
	}
	if len(entries) > 0 {
		return fmt.Errorf("backup: target directory must be empty")
	}
	in, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("backup: open archive: %w", err)
	}
	defer in.Close()
	zr, err := gzip.NewReader(in)
	if err != nil {
		return fmt.Errorf("backup: gzip: %w", err)
	}
	defer zr.Close()
	tr := tar.NewReader(zr)
	seenManifest := false
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("backup: read archive: %w", err)
		}
		if h.Name == manifestName {
			var m Manifest
			if err := json.NewDecoder(io.LimitReader(tr, 1<<20)).Decode(&m); err != nil {
				return fmt.Errorf("backup: manifest: %w", err)
			}
			if m.Format != 1 {
				return fmt.Errorf("backup: unsupported format")
			}
			seenManifest = true
			continue
		}
		clean := filepath.Clean(h.Name)
		if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("backup: unsafe archive path %q", h.Name)
		}
		dest := filepath.Join(dataDir, clean)
		if !strings.HasPrefix(dest, filepath.Clean(dataDir)+string(os.PathSeparator)) {
			return fmt.Errorf("backup: unsafe archive path %q", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dest, os.FileMode(h.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(h.Mode))
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(f, tr)
			closeErr := f.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
	}
	if !seenManifest {
		return fmt.Errorf("backup: manifest missing")
	}
	return nil
}
