package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// TestDeleteExternalLibraryRemovesDerivativesNotOriginals proves removing an
// external library deletes the thumbnails Kuraki generated for it — they used to
// outlive the rows that pointed at them — while never touching the external
// original, which Kuraki does not own.
func TestDeleteExternalLibraryRemovesDerivativesNotOriginals(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	var owner string
	if err := database.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	externalDir := t.TempDir()
	original := filepath.Join(externalDir, "IMG_1.jpg")
	if err := os.WriteFile(original, []byte("external original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO external_libraries (id, owner_id, name, root_path) VALUES ('lib1', ?, 'Old drive', ?)`,
		owner, externalDir); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, external_path, external_library_id, filename, mime_type, media_type)
		VALUES ('ext1', ?, 'hash-ext1', '', ?, 'lib1', 'IMG_1.jpg', 'image/jpeg', 'image')`, owner, original); err != nil {
		t.Fatal(err)
	}
	files := []string{"ext1/thumb_512_g0.jpg", "ext1/thumb_1200_g0.jpg"}
	for _, rel := range files {
		if _, err := store.Write(ctx, "derivatives/"+rel, strings.NewReader("x")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.Exec(`INSERT INTO derivatives (asset_id, kind, format, path) VALUES ('ext1', 'thumb', 'jpeg', ?)`, files[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO thumb_variants (asset_id, edge, gen, format, path) VALUES ('ext1', 1200, 0, 'jpeg', ?)`, files[1]); err != nil {
		t.Fatal(err)
	}

	rec := deleteWithCookie(t, router, "/api/external-libraries/lib1", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete external library = %d body=%s, want 200", rec.Code, rec.Body.String())
	}
	for _, rel := range files {
		if ok, _ := store.Exists(ctx, "derivatives/"+rel); ok {
			t.Fatalf("derivatives/%s survived external library removal", rel)
		}
	}
	if _, err := os.Stat(original); err != nil {
		t.Fatalf("external original was touched: %v", err)
	}
}
