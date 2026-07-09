package db

import (
	"context"
	"path/filepath"
	"testing"
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
