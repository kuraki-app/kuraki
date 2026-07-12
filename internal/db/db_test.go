package db

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

func TestOpenAndMigrate(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")

	d, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()

	snapshotCalled := false
	if err := Migrate(d, func() error { snapshotCalled = true; return nil }); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Fresh DB (version 0): no snapshot should be taken on first bootstrap.
	if snapshotCalled {
		t.Error("snapshot should NOT run on first-time migration")
	}

	// WAL mode should be active.
	var mode string
	if err := d.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}

	// Core tables must exist.
	for _, tbl := range []string{"users", "assets", "derivatives", "sessions", "import_state", "change_log", "assets_fts"} {
		var name string
		err := d.QueryRowContext(ctx,
			"SELECT name FROM sqlite_master WHERE name = ?", tbl).Scan(&name)
		if err != nil {
			t.Errorf("table %q missing: %v", tbl, err)
		}
	}

	// Running migrate again is a no-op and still takes no snapshot (already current).
	if err := Migrate(d, func() error { snapshotCalled = true; return nil }); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
	if snapshotCalled {
		t.Error("snapshot should not run when already at latest version")
	}
}

// TestLatestMigrationDownUp verifies every release can execute the latest
// rollback script and re-apply it. User-facing rollback remains the automatic
// pre-migration snapshot; this test catches broken Goose Down statements.
func TestLatestMigrationDownUp(t *testing.T) {
	ctx := context.Background()
	d, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := Migrate(d, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	before, err := goose.GetDBVersion(d)
	if err != nil {
		t.Fatalf("version before down: %v", err)
	}
	if err := goose.Down(d, "."); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := Migrate(d, nil); err != nil {
		t.Fatalf("up after down: %v", err)
	}
	after, err := goose.GetDBVersion(d)
	if err != nil {
		t.Fatalf("version after up: %v", err)
	}
	if after != before {
		t.Fatalf("version after down/up = %d, want %d", after, before)
	}
	if _, err := d.ExecContext(ctx, `INSERT INTO users(id,username,password_hash) VALUES ('test','test','hash')`); err != nil {
		t.Fatalf("database unusable after down/up: %v", err)
	}
}
