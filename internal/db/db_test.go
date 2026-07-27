package db

import (
	"context"
	"database/sql"
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
	// This models an existing v17 library with real rows before the new migration
	// is applied, rather than merely exercising empty-schema DDL.
	if _, err := d.ExecContext(ctx, `INSERT INTO users(id,username,password_hash) VALUES ('legacy','legacy','hash')`); err != nil {
		t.Fatalf("insert historical row: %v", err)
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
	var username string
	if err := d.QueryRowContext(ctx, `SELECT username FROM users WHERE id='legacy'`).Scan(&username); err != nil || username != "legacy" {
		t.Fatalf("historical row after upgrade = %q, %v", username, err)
	}
	if _, err := d.ExecContext(ctx, `INSERT INTO users(id,username,password_hash) VALUES ('test','test','hash')`); err != nil {
		t.Fatalf("database unusable after down/up: %v", err)
	}
}

// TestChangeLogOwnerMigration verifies migration 00020 adds a writable
// owner_id column and its lookup index to change_log.
func TestChangeLogOwnerMigration(t *testing.T) {
	ctx := context.Background()
	database, err := Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	// Column exists and is writable.
	if _, err := database.Exec(
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset','x','create','owner-1')`); err != nil {
		t.Fatalf("owner_id column missing/unusable: %v", err)
	}
	// Index exists.
	var name string
	if err := database.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='index' AND name='ix_change_log_owner_id'`).Scan(&name); err != nil {
		t.Fatalf("index ix_change_log_owner_id missing: %v", err)
	}
}

// TestMultiUserMigration verifies migration 00023 against a library that
// already has rows, not merely against empty-schema DDL. It models the real
// upgrade: one existing owner, import state, and a change_log row whose asset
// was purged before 00020 ran (so its owner_id stayed NULL).
func TestMultiUserMigration(t *testing.T) {
	ctx := context.Background()
	database, err := Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	// Roll back to the pre-00023 schema and seed it like a live library.
	if err := goose.DownTo(database, ".", 22); err != nil {
		t.Fatalf("down to 22: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users(id,username,password_hash) VALUES ('sole','sole','hash')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO import_state(source_path,size,mtime,status) VALUES ('/nas/a.jpg',1,'m','done')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO change_log(entity,entity_id,op,owner_id) VALUES ('asset','purged','delete',NULL)`); err != nil {
		t.Fatal(err)
	}

	if err := Migrate(database, nil); err != nil {
		t.Fatalf("up to 23: %v", err)
	}

	// The sole pre-existing owner keeps control of their server.
	var role string
	if err := database.QueryRowContext(ctx, `SELECT role FROM users WHERE id='sole'`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "admin" {
		t.Fatalf("existing owner role = %q, want admin", role)
	}

	// disabled_at exists and defaults to NULL (nobody is disabled by upgrading).
	var disabled sql.NullString
	if err := database.QueryRowContext(ctx, `SELECT disabled_at FROM users WHERE id='sole'`).Scan(&disabled); err != nil {
		t.Fatal(err)
	}
	if disabled.Valid {
		t.Fatalf("disabled_at = %v, want NULL", disabled)
	}

	// Only 'admin' and 'user' are accepted.
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users(id,username,password_hash,role) VALUES ('x','x','h','superuser')`); err == nil {
		t.Fatal("role CHECK constraint missing: accepted 'superuser'")
	}

	// Import state survives the rebuild, attributed to the sole owner.
	var owner, path string
	if err := database.QueryRowContext(ctx,
		`SELECT owner_id, source_path FROM import_state`).Scan(&owner, &path); err != nil {
		t.Fatalf("import_state row lost in rebuild: %v", err)
	}
	if owner != "sole" || path != "/nas/a.jpg" {
		t.Fatalf("import_state = (%q,%q), want (sole,/nas/a.jpg)", owner, path)
	}

	// The whole point of the rebuild: two owners can now hold the same path.
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users(id,username,password_hash) VALUES ('second','second','hash')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO import_state(owner_id,source_path,size,mtime,status) VALUES ('second','/nas/a.jpg',1,'m','done')`); err != nil {
		t.Fatalf("second owner cannot import the same source path: %v", err)
	}
	// ...but one owner still cannot hold it twice.
	if _, err := database.ExecContext(ctx,
		`INSERT INTO import_state(owner_id,source_path,size,mtime,status) VALUES ('second','/nas/a.jpg',1,'m','done')`); err == nil {
		t.Fatal("composite primary key missing: duplicate (owner,path) accepted")
	}

	// The orphaned change_log row is attributed, not stranded -- otherwise
	// dropping the feed's `OR owner_id IS NULL` clause would hide it forever.
	var logOwner sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT owner_id FROM change_log WHERE entity_id='purged'`).Scan(&logOwner); err != nil {
		t.Fatal(err)
	}
	if !logOwner.Valid || logOwner.String != "sole" {
		t.Fatalf("orphaned change_log owner = %v, want sole", logOwner)
	}
}
