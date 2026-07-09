package trash

import (
	"bytes"
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func setup(t *testing.T) (context.Context, *sql.DB, storage.Storage) {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dir, "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash) VALUES ('u1','owner','')`); err != nil {
		t.Fatal(err)
	}
	return ctx, database, store
}

func addAsset(t *testing.T, ctx context.Context, database *sql.DB, store storage.Storage, id, path string) {
	t.Helper()
	if _, err := store.Write(ctx, "originals/"+path, bytes.NewReader([]byte("bytes-"+id))); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
		VALUES (?, 'u1', ?, ?, ?, 'image/jpeg', 'image')`,
		id, "hash-"+id, path, filepath.Base(path)); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO derivatives (asset_id, kind, format, path) VALUES (?, 'thumb', 'jpeg', ?)`,
		id, id+"/thumb.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(ctx, "derivatives/"+id+"/thumb.jpg", bytes.NewReader([]byte("thumb"))); err != nil {
		t.Fatal(err)
	}
}

func exists(t *testing.T, ctx context.Context, store storage.Storage, rel string) bool {
	ok, err := store.Exists(ctx, rel)
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestDeleteRestorePurge(t *testing.T) {
	ctx, database, store := setup(t)
	addAsset(t, ctx, database, store, "a1", "2026/07/a1.jpg")

	// Delete: original moves to trash, deleted_at set.
	if err := Delete(ctx, database, store, "a1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if exists(t, ctx, store, "originals/2026/07/a1.jpg") {
		t.Error("original should be gone after delete")
	}
	if !exists(t, ctx, store, "trash/2026/07/a1.jpg") {
		t.Error("file should be in trash after delete")
	}
	if err := Delete(ctx, database, store, "a1"); err != ErrAlreadyDeleted {
		t.Errorf("second delete = %v, want ErrAlreadyDeleted", err)
	}

	// Restore: file comes back, deleted_at cleared.
	if err := Restore(ctx, database, store, "a1"); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !exists(t, ctx, store, "originals/2026/07/a1.jpg") {
		t.Error("original should be restored")
	}

	// Delete again then purge everything older than "now + 1h".
	if err := Delete(ctx, database, store, "a1"); err != nil {
		t.Fatal(err)
	}
	n, err := PurgeExpired(ctx, database, store, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if n != 1 {
		t.Fatalf("purged %d, want 1", n)
	}
	if exists(t, ctx, store, "trash/2026/07/a1.jpg") {
		t.Error("trash file should be removed after purge")
	}
	if exists(t, ctx, store, "derivatives/a1/thumb.jpg") {
		t.Error("derivative file should be removed after purge")
	}
	var count int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("assets remaining = %d, want 0", count)
	}

	// Not-yet-expired assets survive purge.
	addAsset(t, ctx, database, store, "a2", "2026/07/a2.jpg")
	if err := Delete(ctx, database, store, "a2"); err != nil {
		t.Fatal(err)
	}
	n, err = PurgeExpired(ctx, database, store, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("purged %d recently-deleted, want 0", n)
	}
}
