package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/importer"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/kuraki-app/kuraki/internal/verify"
)

func TestExternalAssetCanBeReadVerifiedRebuiltExportedAndTrashed(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(data, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(data)
	if err != nil {
		t.Fatal(err)
	}
	processor := media.NewPureGo()
	router := NewRouter(Deps{DB: database, Store: store, Media: processor, Logger: slog.Default()})
	cookie := setupTestSession(t, router)
	source := t.TempDir()
	path := filepath.Join(source, "external.jpg")
	writeHTTPJPEG(t, path)
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	linked := postJSON(t, router, "/api/external-libraries", apitypes.ExternalLibraryRequest{Name: "Drive", RootPath: source}, cookie)
	if linked.Code != http.StatusCreated {
		t.Fatalf("link=%d %s", linked.Code, linked.Body)
	}
	assets := getJSONWithCookie[apitypes.AssetList](t, router, "/api/assets", cookie)
	if len(assets.Assets) != 1 {
		t.Fatalf("external assets=%d", len(assets.Assets))
	}
	id := assets.Assets[0].ID
	if thumb := getJSON(t, router, "/api/assets/"+id+"/thumb", cookie); thumb.Code != http.StatusOK {
		t.Fatalf("indexed thumbnail=%d %s", thumb.Code, thumb.Body)
	}
	read := getJSON(t, router, "/api/assets/"+id+"/original", cookie)
	if read.Code != http.StatusOK || string(read.Body.Bytes()) != string(original) {
		t.Fatalf("external read=%d", read.Code)
	}
	checked, err := (&verify.Verifier{DB: database, Store: store}).Run(ctx, nil)
	if err != nil || !checked.Healthy() || checked.Checked != 1 {
		t.Fatalf("verify=%+v err=%v", checked, err)
	}
	runner := importer.Importer{DB: database, Store: store, Media: processor}
	if err := runner.RebuildDerivatives(ctx, id); err != nil {
		t.Fatal(err)
	}
	for _, export := range []string{"/api/assets/zip", "/api/export"} {
		var recBody []byte
		if export == "/api/assets/zip" {
			rec := postJSON(t, router, export, apitypes.ZipRequest{IDs: []string{id}}, cookie)
			if rec.Code != http.StatusOK {
				t.Fatalf("zip=%d %s", rec.Code, rec.Body)
			}
			recBody = rec.Body.Bytes()
		} else {
			rec := getJSON(t, router, export, cookie)
			if rec.Code != http.StatusOK {
				t.Fatalf("export=%d %s", rec.Code, rec.Body)
			}
			recBody = rec.Body.Bytes()
		}
		entries := readZip(t, recBody)
		if len(entries) != 1 || string(entries[0].data) != string(original) {
			t.Fatal("external bytes missing from export")
		}
	}
	if rec := deleteWithCookie(t, router, "/api/assets/"+id, cookie); rec.Code != http.StatusOK {
		t.Fatalf("trash=%d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(t, router, "/api/assets/"+id+"/restore", json.RawMessage(`{}`), cookie); rec.Code != http.StatusOK {
		t.Fatalf("restore=%d %s", rec.Code, rec.Body)
	}
	deleteWithCookie(t, router, "/api/assets/"+id, cookie)
	if rec := deleteWithCookie(t, router, "/api/trash/"+id, cookie); rec.Code != http.StatusOK {
		t.Fatalf("purge=%d %s", rec.Code, rec.Body)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(original) {
		t.Fatalf("external original changed: %v", err)
	}
}
