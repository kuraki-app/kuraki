package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestThumbVariantsMigration(t *testing.T) {
	ctx := context.Background()
	database, err := Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := Migrate(database, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('u1','owner','')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
		VALUES ('a1','u1','h','2026/09/a1.jpg','a1.jpg','image/jpeg','image')`); err != nil {
		t.Fatal(err)
	}
	var gen int
	if err := database.QueryRow(`SELECT derivative_gen FROM assets WHERE id = 'a1'`).Scan(&gen); err != nil || gen != 0 {
		t.Fatalf("derivative_gen = %d, %v; want 0", gen, err)
	}
	if _, err := database.Exec(`INSERT INTO thumb_variants (asset_id, edge, gen, format, path) VALUES ('a1', 1200, 0, 'jpeg', 'a1/thumb_1200_g0.jpg')`); err != nil {
		t.Fatalf("insert allowed edge: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO thumb_variants (asset_id, edge, gen, format, path) VALUES ('a1', 777, 0, 'jpeg', 'x')`); err == nil {
		t.Fatal("edge 777 accepted; CHECK constraint missing")
	}
	if _, err := database.Exec(`DELETE FROM assets WHERE id = 'a1'`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := database.QueryRow(`SELECT COUNT(*) FROM thumb_variants`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("variants after asset delete = %d, %v; want cascade to 0", n, err)
	}
}
