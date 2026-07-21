package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

func TestExportLibraryStreamsOriginalBytes(t *testing.T) {
	ctx := context.Background()
	database, store, _ := seedHTTPAsset(t, ctx)
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	req := httptest.NewRequest(http.MethodGet, "/api/export", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("export status = %d body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/zip" {
		t.Fatalf("content-type = %q, want application/zip", got)
	}
	entries := readZip(t, rec.Body.Bytes())
	if len(entries) != 1 {
		t.Fatalf("zip has %d entries, want 1", len(entries))
	}
	if entries[0].name == "" || len(entries[0].data) == 0 {
		t.Fatalf("zip entry = %+v, want named original bytes", entries[0])
	}
}

func TestZipExportRejectsUnavailableOriginal(t *testing.T) {
	ctx := context.Background()
	database, store, _ := seedHTTPAsset(t, ctx)
	var id, originalPath string
	if err := database.QueryRowContext(ctx, `SELECT id, original_path FROM assets`).Scan(&id, &originalPath); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(ctx, "originals/"+originalPath); err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})
	cookie := setupTestSession(t, router)
	body, err := json.Marshal(apitypes.ZipRequest{IDs: []string{id}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/assets/zip", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("zip status = %d body = %s, want 409", rec.Code, rec.Body.String())
	}
}

func TestTimeoutExceptLeavesExportsUnlimited(t *testing.T) {
	for _, tc := range []struct {
		path        string
		wantTimeout bool
	}{
		{path: "/api/export"},
		{path: "/api/assets/zip"},
		{path: "/api/assets", wantTimeout: true},
	} {
		t.Run(tc.path, func(t *testing.T) {
			h := timeoutExcept(time.Minute, "/api/export", "/api/assets/zip")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, hasDeadline := r.Context().Deadline()
				if hasDeadline != tc.wantTimeout {
					t.Fatalf("deadline = %v, want %v", hasDeadline, tc.wantTimeout)
				}
			}))
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, tc.path, nil))
		})
	}
}

type zipEntry struct {
	name string
	data []byte
}

func readZip(t *testing.T, body []byte) []zipEntry {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	entries := make([]zipEntry, 0, len(zr.File))
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(rc)
		closeErr := rc.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		entries = append(entries, zipEntry{name: f.Name, data: data})
	}
	return entries
}
