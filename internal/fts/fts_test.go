package fts

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, stmt := range []string{
		`CREATE VIRTUAL TABLE assets_fts USING fts5(asset_id UNINDEXED, filename, camera_model, taken_text, description, ocr_text)`,
		`CREATE VIRTUAL TABLE assets_fts_tri USING fts5(asset_id UNINDEXED, filename, camera_model, taken_text, description, ocr_text, tokenize='trigram')`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func count(t *testing.T, db *sql.DB, table, match string) int {
	t.Helper()
	var n int
	q := `SELECT count(*) FROM ` + table + ` WHERE ` + table + ` MATCH ?`
	if err := db.QueryRow(q, match).Scan(&n); err != nil {
		t.Fatalf("%s MATCH %s: %v", table, match, err)
	}
	return n
}

// Replace must write both indexes: the prefix index answers 1-2 character
// queries and the trigram index answers substrings, so a row missing from
// either is invisible to half the searches the UI can issue.
func TestReplaceWritesBothIndexes(t *testing.T) {
	db := newDB(t)
	row := Row{AssetID: "a1", Filename: "Screenshot 2026-07-13.png", TakenText: "2026-07-13"}
	if err := Replace(context.Background(), db, row); err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, "assets_fts", `"sc"*`); got != 1 {
		t.Errorf("prefix index: got %d, want 1", got)
	}
	if got := count(t, db, "assets_fts_tri", `"reensho"`); got != 1 {
		t.Errorf("trigram index: got %d, want 1", got)
	}
}

// Replace is a replace, not an append: called twice it must leave one row, or
// an edited caption would match its own previous text forever.
func TestReplaceIsIdempotent(t *testing.T) {
	db := newDB(t)
	ctx := context.Background()
	if err := Replace(ctx, db, Row{AssetID: "a1", Filename: "old.png"}); err != nil {
		t.Fatal(err)
	}
	if err := Replace(ctx, db, Row{AssetID: "a1", Filename: "new.png"}); err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, "assets_fts_tri", `"new"`); got != 1 {
		t.Errorf("new text: got %d, want 1", got)
	}
	if got := count(t, db, "assets_fts_tri", `"old"`); got != 0 {
		t.Errorf("stale text still indexed: got %d, want 0", got)
	}
}

func TestDeleteClearsBothIndexes(t *testing.T) {
	db := newDB(t)
	ctx := context.Background()
	if err := Replace(ctx, db, Row{AssetID: "a1", Filename: "gone.png"}); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, db, "a1"); err != nil {
		t.Fatal(err)
	}
	if got := count(t, db, "assets_fts", `"gone"*`); got != 0 {
		t.Errorf("prefix index: got %d, want 0", got)
	}
	if got := count(t, db, "assets_fts_tri", `"gone"`); got != 0 {
		t.Errorf("trigram index: got %d, want 0", got)
	}
}
