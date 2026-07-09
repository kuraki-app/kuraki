package verify

import (
	"bytes"
	"context"
	"encoding/hex"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/zeebo/blake3"
)

func hashOf(b []byte) string {
	h := blake3.New()
	_, _ = h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

func TestVerify(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	database, err := db.Open(ctx, filepath.Join(dir, "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
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
	insert := func(id, hash, path, name string) {
		t.Helper()
		if _, err := database.ExecContext(ctx, `
			INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
			VALUES (?, 'u1', ?, ?, ?, 'image/jpeg', 'image')`,
			id, hash, path, name); err != nil {
			t.Fatal(err)
		}
	}

	// good: stored hash matches the file
	good := []byte("hello world")
	if _, err := store.Write(ctx, "originals/2026/07/good.jpg", bytes.NewReader(good)); err != nil {
		t.Fatal(err)
	}
	insert("a-good", hashOf(good), "2026/07/good.jpg", "good.jpg")

	// mismatch: file exists but stored hash is wrong (simulates bit-rot)
	if _, err := store.Write(ctx, "originals/2026/07/bad.jpg", bytes.NewReader([]byte("corrupted"))); err != nil {
		t.Fatal(err)
	}
	insert("a-bad", hashOf([]byte("original-bytes")), "2026/07/bad.jpg", "bad.jpg")

	// missing: no file on disk
	insert("a-missing", hashOf([]byte("whatever")), "2026/07/missing.jpg", "missing.jpg")

	v := Verifier{DB: database, Store: store}
	res, err := v.Run(ctx, nil)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Checked != 3 || res.OK != 1 {
		t.Fatalf("checked=%d ok=%d, want 3/1", res.Checked, res.OK)
	}
	if res.Healthy() {
		t.Fatal("expected library to be unhealthy")
	}

	got := map[Status]string{}
	for _, p := range res.Problems {
		got[p.Status] = p.AssetID
	}
	if got[StatusMismatch] != "a-bad" {
		t.Errorf("mismatch = %q, want a-bad", got[StatusMismatch])
	}
	if got[StatusMissing] != "a-missing" {
		t.Errorf("missing = %q, want a-missing", got[StatusMissing])
	}
}
