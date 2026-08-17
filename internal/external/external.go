// Package external indexes read-only media folders without copying originals.
package external

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/fts"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/zeebo/blake3"
)

type Result struct{ Scanned, Indexed, Skipped int }

// Scan indexes an existing directory. It does not write, rename, or remove a
// source file; only the database and replaceable derivatives may change.
func Scan(ctx context.Context, db *sql.DB, processor media.Processor, libraryID, ownerID, root string) (Result, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return Result{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return Result{}, err
	}
	if !info.IsDir() {
		return Result{}, fmt.Errorf("external: root is not a directory")
	}
	result := Result{}
	err = filepath.WalkDir(root, func(path string, e os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if e.IsDir() {
			return nil
		}
		cap, ok := media.Classify(path)
		if !ok {
			return nil
		}
		result.Scanned++
		hash, err := hash(path)
		if err != nil {
			return err
		}
		meta, err := processor.Probe(ctx, path)
		if err != nil {
			meta.MimeType = cap.MimeType
			meta.MediaType = cap.MediaType
		}
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		res, err := db.ExecContext(ctx, `INSERT INTO assets (id,owner_id,content_hash,original_path,filename,mime_type,media_type,width,height,size_bytes,duration_ms,external_library_id,external_path,web_viewable) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, id.String(), ownerID, hash, "external/"+id.String(), filepath.Base(path), meta.MimeType, string(cap.MediaType), meta.Width, meta.Height, fileSize(path), meta.DurationMS, libraryID, path, boolInt(meta.WebViewable))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			result.Skipped++
			return nil
		}
		if err := fts.Replace(ctx, db, fts.Row{
			AssetID: id.String(), Filename: filepath.Base(path), CameraModel: meta.CameraModel,
		}); err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO change_log(entity,entity_id,op,owner_id) VALUES('asset',?,'create',?)`, id.String(), ownerID); err != nil {
			return err
		}
		result.Indexed++
		return nil
	})
	return result, err
}
func hash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := blake3.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

var _ = time.Now
