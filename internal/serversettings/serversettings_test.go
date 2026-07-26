package serversettings

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	return database
}

func TestLoadAllEmpty(t *testing.T) {
	database := newTestDB(t)
	rows, err := LoadAll(context.Background(), database)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("fresh table must be empty, got %v", rows)
	}
}

func TestSaveThenLoadAll(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()
	if err := Save(ctx, database, "trash_retention_days", "14"); err != nil {
		t.Fatal(err)
	}
	rows, err := LoadAll(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	if rows["trash_retention_days"] != "14" {
		t.Fatalf("rows = %v, want trash_retention_days=14", rows)
	}
}

func TestSaveOverwritesExisting(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()
	if err := Save(ctx, database, "backup_dir", "/first"); err != nil {
		t.Fatal(err)
	}
	if err := Save(ctx, database, "backup_dir", "/second"); err != nil {
		t.Fatal(err)
	}
	rows, err := LoadAll(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	if rows["backup_dir"] != "/second" {
		t.Fatalf("second Save must overwrite the first, got %q", rows["backup_dir"])
	}
}

func TestSaveExplicitEmptyIsStored(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()
	if err := Save(ctx, database, "backup_dir", "/set"); err != nil {
		t.Fatal(err)
	}
	if err := Save(ctx, database, "backup_dir", ""); err != nil {
		t.Fatal(err)
	}
	rows, err := LoadAll(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	v, ok := rows["backup_dir"]
	if !ok || v != "" {
		t.Fatalf("an explicit empty Save must leave a present, empty row, got ok=%v v=%q", ok, v)
	}
}
