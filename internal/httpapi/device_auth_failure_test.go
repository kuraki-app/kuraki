package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// A database that cannot answer must not be reported as a revoked device.
//
// 401 is the client's instruction to delete its credential — that is what a
// revoked device means, and the mobile app acts on it permanently. Reporting a
// failed lookup the same way turned a momentary fault into every paired phone
// unpairing itself and needing a human to re-pair it.
//
// This is not hypothetical. A 156ms burst of `database disk image is malformed`
// produced 19 such 401s, and a phone that had paired seconds earlier deleted its
// token and raised "This device was disconnected".
func TestDeviceAuthFailureIsNotARevocation(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Logger: slog.Default()})

	// Claim the owner so the router is past first-run setup, then break the
	// lookup the way a fault does: the table is gone, so the query errors
	// rather than returning no rows.
	if code := postJSON(t, router, "/api/setup",
		apitypes.Credentials{Username: "admin", Password: "correct horse"}, nil).Code; code != http.StatusCreated {
		t.Fatalf("setup = %d", code)
	}
	if _, err := database.ExecContext(ctx, `DROP TABLE devices`); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	req.Header.Set("Authorization", "Bearer some-device-token")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatal("a failed device lookup answered 401, which tells the phone to delete a token that may be valid")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d so the client retries instead of forgetting its credential",
			rec.Code, http.StatusServiceUnavailable)
	}
}

// The other half: a token that genuinely is not a device must still be a 401,
// or a revoked phone would retry forever instead of prompting to re-pair.
func TestUnknownDeviceTokenIsStillUnauthorized(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	if code := postJSON(t, router, "/api/setup",
		apitypes.Credentials{Username: "admin", Password: "correct horse"}, nil).Code; code != http.StatusCreated {
		t.Fatalf("setup = %d", code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 for a token no device owns", rec.Code)
	}
}
