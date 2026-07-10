// Package backup creates and restores portable Kuraki library archives.
package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const manifestName = "kuraki-backup.json"
const currentFormat = 2

type Manifest struct {
	Format     int       `json:"format"`
	CreatedAt  time.Time `json:"created_at"`
	FileCount  int       `json:"file_count,omitempty"`
	TotalBytes int64     `json:"total_bytes,omitempty"`
}

// Create archives all durable library data except transient staging and upgrade
// snapshots. Originals remain byte-for-byte unchanged in the archive.
func Create(ctx context.Context, dataDir, destination string) error {
	return create(ctx, dataDir, destination, "")
}

// CreateLive takes a SQLite-consistent snapshot before packaging a running
// library. The snapshot captures WAL contents at one point in time; originals
// are write-once, so copying them afterwards cannot leave an asset referenced
// by the snapshot without its original file.
func CreateLive(ctx context.Context, database *sql.DB, dataDir, destination string) error {
	if database == nil {
		return fmt.Errorf("backup: database is nil")
	}
	tmpDir, err := os.MkdirTemp("", "kuraki-backup-db-*")
	if err != nil {
		return fmt.Errorf("backup: create database snapshot directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)
	snapshotPath := filepath.Join(tmpDir, "kuraki.db")
	if _, err := database.ExecContext(ctx, "VACUUM INTO ?", snapshotPath); err != nil {
		return fmt.Errorf("backup: snapshot database: %w", err)
	}
	return create(ctx, dataDir, destination, snapshotPath)
}

func create(ctx context.Context, dataDir, destination, snapshotPath string) error {
	out, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("backup: create archive: %w", err)
	}
	defer out.Close()
	zw := gzip.NewWriter(out)
	defer zw.Close()
	tw := tar.NewWriter(zw)
	defer tw.Close()
	var fileCount int
	var totalBytes int64
	writeFile := func(path, name string, info os.FileInfo) error {
		h := &tar.Header{Name: name, Mode: int64(info.Mode().Perm()), ModTime: info.ModTime(), Size: info.Size()}
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
		if closeErr != nil {
			return closeErr
		}
		fileCount++
		totalBytes += info.Size()
		return nil
	}
	if snapshotPath != "" {
		info, err := os.Stat(snapshotPath)
		if err != nil {
			return fmt.Errorf("backup: inspect database snapshot: %w", err)
		}
		if err := writeFile(snapshotPath, "kuraki.db", info); err != nil {
			return fmt.Errorf("backup: archive database snapshot: %w", err)
		}
	}
	if err := filepath.WalkDir(dataDir, func(path string, entry os.DirEntry, walkErr error) error {
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
		// A live backup archives the consistent snapshot instead of copying the
		// mutable main/WAL/SHM files that happen to exist during the walk.
		if snapshotPath != "" && (rel == "kuraki.db" || rel == "kuraki.db-wal" || rel == "kuraki.db-shm") {
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
		return writeFile(path, name, info)
	}); err != nil {
		return err
	}
	manifest, err := json.Marshal(Manifest{
		Format: currentFormat, CreatedAt: time.Now().UTC(), FileCount: fileCount, TotalBytes: totalBytes,
	})
	if err != nil {
		return fmt.Errorf("backup: marshal manifest: %w", err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: manifestName, Mode: 0o600, Size: int64(len(manifest)), ModTime: time.Now()}); err != nil {
		return fmt.Errorf("backup: write manifest header: %w", err)
	}
	if _, err := tw.Write(manifest); err != nil {
		return fmt.Errorf("backup: write manifest: %w", err)
	}
	return nil
}

// Restore expands an archive into an empty directory. It rejects traversal and
// incomplete archives before replacing the destination directory.
func Restore(ctx context.Context, source, dataDir string) error {
	targetExists, err := emptyTarget(dataDir)
	if err != nil {
		return err
	}
	dataDir = filepath.Clean(dataDir)
	parent, base := filepath.Dir(dataDir), filepath.Base(dataDir)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("backup: create restore parent: %w", err)
	}
	staging, err := os.MkdirTemp(parent, "."+base+".restore-*")
	if err != nil {
		return fmt.Errorf("backup: create restore staging: %w", err)
	}
	if err := os.Chmod(staging, 0o755); err != nil {
		os.RemoveAll(staging)
		return fmt.Errorf("backup: set restore staging permissions: %w", err)
	}
	defer os.RemoveAll(staging)

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
	var manifest *Manifest
	var fileCount int
	var totalBytes int64
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
			if manifest != nil {
				return fmt.Errorf("backup: duplicate manifest")
			}
			var m Manifest
			if err := json.NewDecoder(io.LimitReader(tr, 1<<20)).Decode(&m); err != nil {
				return fmt.Errorf("backup: manifest: %w", err)
			}
			if m.Format != 1 && m.Format != currentFormat {
				return fmt.Errorf("backup: unsupported format")
			}
			manifest = &m
			continue
		}
		clean := filepath.Clean(h.Name)
		if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("backup: unsafe archive path %q", h.Name)
		}
		dest := filepath.Join(staging, clean)
		if !strings.HasPrefix(dest, staging+string(os.PathSeparator)) {
			return fmt.Errorf("backup: unsafe archive path %q", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dest, os.FileMode(h.Mode)); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
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
			fileCount++
			totalBytes += h.Size
		default:
			return fmt.Errorf("backup: unsupported archive entry %q", h.Name)
		}
	}
	if manifest == nil {
		return fmt.Errorf("backup: manifest missing")
	}
	if manifest.Format == currentFormat && (manifest.FileCount != fileCount || manifest.TotalBytes != totalBytes) {
		return fmt.Errorf("backup: manifest does not match archive contents")
	}
	if err := installRestore(staging, dataDir, targetExists); err != nil {
		return err
	}
	return nil
}

// emptyTarget confirms that dataDir is either absent or an empty real directory.
func emptyTarget(dataDir string) (bool, error) {
	info, err := os.Lstat(dataDir)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("backup: inspect target: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return false, fmt.Errorf("backup: target must be an empty directory")
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return false, fmt.Errorf("backup: inspect target: %w", err)
	}
	if len(entries) > 0 {
		return false, fmt.Errorf("backup: target directory must be empty")
	}
	return true, nil
}

// installRestore swaps validated staging data into the empty target. Keeping
// the old empty directory aside gives us a rollback path if the final rename
// fails, so failed archive validation never leaves a partial library behind.
func installRestore(staging, target string, targetExists bool) error {
	if !targetExists {
		if err := os.Rename(staging, target); err != nil {
			return fmt.Errorf("backup: install restore: %w", err)
		}
		return nil
	}
	parent, base := filepath.Dir(target), filepath.Base(target)
	previous, err := os.MkdirTemp(parent, "."+base+".restore-old-*")
	if err != nil {
		return fmt.Errorf("backup: prepare restore swap: %w", err)
	}
	if err := os.Remove(previous); err != nil {
		return fmt.Errorf("backup: prepare restore swap: %w", err)
	}
	if err := os.Rename(target, previous); err != nil {
		return fmt.Errorf("backup: prepare restore swap: %w", err)
	}
	if err := os.Rename(staging, target); err != nil {
		if rollbackErr := os.Rename(previous, target); rollbackErr != nil {
			return fmt.Errorf("backup: install restore: %w (rollback: %v)", err, rollbackErr)
		}
		return fmt.Errorf("backup: install restore: %w", err)
	}
	if err := os.Remove(previous); err != nil {
		return fmt.Errorf("backup: remove old restore target: %w", err)
	}
	return nil
}
