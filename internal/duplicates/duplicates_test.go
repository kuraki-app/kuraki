package duplicates

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
)

func TestExecutePersistsCompleteGroups(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO users(id,username,password_hash) VALUES('owner','owner','hash')`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b", "c"} {
		hash := 0
		if id == "c" {
			hash = -1
		}
		if _, err := database.ExecContext(ctx, `INSERT INTO assets(id,owner_id,content_hash,original_path,filename,mime_type,media_type,phash) VALUES(?,?,?,?,?,?,?,?)`, id, "owner", id, "2026/01/"+id+".jpg", id+".jpg", "image/jpeg", "image", hash); err != nil {
			t.Fatal(err)
		}
	}
	run, err := Enqueue(ctx, database, "owner")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Execute(ctx, database, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "succeeded" || result.Total != 3 || result.Groups != 1 {
		t.Fatalf("result = %#v", result)
	}
	latest, ok, err := Latest(ctx, database, "owner")
	if err != nil || !ok || latest.ID != run.ID || latest.Processed != 3 {
		t.Fatalf("latest = %#v, ok=%v, err=%v", latest, ok, err)
	}
	var members int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM duplicate_group_members WHERE run_id=?`, run.ID).Scan(&members); err != nil {
		t.Fatal(err)
	}
	if members != 2 {
		t.Fatalf("members = %d, want 2", members)
	}
}
