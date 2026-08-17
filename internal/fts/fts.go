// Package fts keeps the two full-text indexes over assets in step.
//
// There are two on purpose. `assets_fts` uses the default tokenizer, which can
// only match the start of a token, and `assets_fts_tri` uses the trigram
// tokenizer, which matches anywhere inside one but cannot answer a query
// shorter than three characters. Neither covers the whole range of what a user
// types, so both are maintained and the query layer picks one per search (see
// ftsPlan in internal/httpapi).
//
// Every write goes through here because it used to go through seven places:
// the importer, the OCR worker, the metadata editor, trash purge, and both
// external-library paths each ran their own INSERT or DELETE. Adding a second
// index to seven hand-written statements is how one of them gets missed, and a
// missed one fails silently -- the asset simply stops appearing in some
// searches, with nothing to catch it.
package fts

import (
	"context"
	"database/sql"
	"fmt"
)

// Execer is the subset of *sql.DB and *sql.Tx this package needs, so callers
// can pass either. The external-library scanner writes outside a transaction;
// everything else writes inside one.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Row is one asset's searchable text. Zero values are fine -- an asset with no
// camera or caption indexes those columns empty rather than being skipped.
type Row struct {
	AssetID     string
	Filename    string
	CameraModel string
	// TakenText is the capture date as YYYY-MM-DD, so a search for "2026-07"
	// finds a day. Callers derive it from taken_at.
	TakenText   string
	Description string
	OCRText     string
}

// tables lists every index Replace and Delete maintain. Adding a third
// tokenizer means adding one line here, not revisiting the call sites.
var tables = []string{"assets_fts", "assets_fts_tri"}

const insertSQL = `INSERT INTO %s (asset_id, filename, camera_model, taken_text, description, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`

// Replace makes the indexes reflect r exactly, clearing any earlier rows for
// the asset first. Callers inserting a brand-new asset get the same behaviour
// at the cost of one no-op DELETE, which is worth not having two entry points.
func Replace(ctx context.Context, x Execer, r Row) error {
	if err := Delete(ctx, x, r.AssetID); err != nil {
		return err
	}
	for _, t := range tables {
		if _, err := x.ExecContext(ctx, fmt.Sprintf(insertSQL, t),
			r.AssetID, r.Filename, r.CameraModel, r.TakenText, r.Description, r.OCRText); err != nil {
			return fmt.Errorf("fts: insert into %s: %w", t, err)
		}
	}
	return nil
}

// Delete removes an asset from every index. Safe to call for an asset that was
// never indexed.
func Delete(ctx context.Context, x Execer, assetID string) error {
	for _, t := range tables {
		if _, err := x.ExecContext(ctx, `DELETE FROM `+t+` WHERE asset_id = ?`, assetID); err != nil {
			return fmt.Errorf("fts: delete from %s: %w", t, err)
		}
	}
	return nil
}
