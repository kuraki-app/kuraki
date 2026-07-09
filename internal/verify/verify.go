// Package verify re-checksums the library against the BLAKE3 hashes recorded at
// import time, so bit-rot, truncated copies, or missing originals are detectable
// on demand (F-12). Originals are read through storage.Storage, keeping verify
// backend-agnostic (works against the filesystem today, S3 later).
package verify

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/zeebo/blake3"
)

// Status classifies the outcome of checking one asset.
type Status string

const (
	StatusOK       Status = "ok"       // stored hash matches the file on disk
	StatusMismatch Status = "mismatch" // file exists but its hash differs (corruption)
	StatusMissing  Status = "missing"  // the original file is gone
	StatusError    Status = "error"    // could not read/hash the file
)

// Problem is a single non-OK finding.
type Problem struct {
	AssetID  string
	Path     string // original path relative to the originals root
	Filename string
	Status   Status
	Expected string // stored BLAKE3 hex
	Actual   string // recomputed BLAKE3 hex (mismatch only)
	Err      string // populated for StatusError
}

// Result summarizes a verification run.
type Result struct {
	Checked  int
	OK       int
	Problems []Problem
}

// Healthy reports whether the library verified cleanly.
func (r Result) Healthy() bool { return len(r.Problems) == 0 }

// Verifier re-hashes originals and compares against the database.
type Verifier struct {
	DB    *sql.DB
	Store storage.Storage
}

// Run re-hashes every non-deleted original and compares it to the stored hash.
// progress, if non-nil, is called after each asset with (done, total).
func (v *Verifier) Run(ctx context.Context, progress func(done, total int)) (Result, error) {
	if v.DB == nil || v.Store == nil {
		return Result{}, fmt.Errorf("verify: db and storage are required")
	}

	var total int
	if err := v.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL`).Scan(&total); err != nil {
		return Result{}, fmt.Errorf("verify: count assets: %w", err)
	}

	rows, err := v.DB.QueryContext(ctx,
		`SELECT id, original_path, filename, content_hash
		 FROM assets WHERE deleted_at IS NULL
		 ORDER BY created_at, id`)
	if err != nil {
		return Result{}, fmt.Errorf("verify: query assets: %w", err)
	}
	defer rows.Close()

	var result Result
	done := 0
	for rows.Next() {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		var id, path, filename, expected string
		if err := rows.Scan(&id, &path, &filename, &expected); err != nil {
			return result, fmt.Errorf("verify: scan asset: %w", err)
		}
		result.Checked++
		done++

		if p := v.checkOne(ctx, id, path, filename, expected); p.Status == StatusOK {
			result.OK++
		} else {
			result.Problems = append(result.Problems, p)
		}
		if progress != nil {
			progress(done, total)
		}
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("verify: iterate assets: %w", err)
	}
	return result, nil
}

func (v *Verifier) checkOne(ctx context.Context, id, path, filename, expected string) Problem {
	base := Problem{AssetID: id, Path: path, Filename: filename, Expected: expected}

	rc, err := v.Store.Open(ctx, "originals/"+path)
	if err != nil {
		base.Status = StatusError
		if errors.Is(err, fs.ErrNotExist) {
			base.Status = StatusMissing
		}
		base.Err = err.Error()
		return base
	}
	defer rc.Close()

	h := blake3.New()
	if _, err := io.Copy(h, rc); err != nil {
		base.Status = StatusError
		base.Err = err.Error()
		return base
	}

	actual := hex.EncodeToString(h.Sum(nil))
	if actual != expected {
		base.Status = StatusMismatch
		base.Actual = actual
		return base
	}
	base.Status = StatusOK
	return base
}
