package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func TestPairingCodeClaimCreatesDevice(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store})
	cookie := setupTestSession(t, router)

	// Owner mints a pairing code from an authenticated web session.
	codeRec := postJSON(t, router, "/api/devices/pair", map[string]string{}, cookie)
	if codeRec.Code != http.StatusCreated {
		t.Fatalf("pair status = %d body=%s", codeRec.Code, codeRec.Body.String())
	}
	var minted pairingCodeResponse
	if err := json.Unmarshal(codeRec.Body.Bytes(), &minted); err != nil {
		t.Fatal(err)
	}
	if minted.Code == "" {
		t.Fatal("pairing code missing")
	}

	// The phone redeems it with no session cookie and receives a device token.
	claim := claimPairing(t, router, minted.Code, "Kitchen phone")
	if claim.Code != http.StatusCreated {
		t.Fatalf("claim status = %d body=%s", claim.Code, claim.Body.String())
	}
	var device deviceResponse
	if err := json.Unmarshal(claim.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}
	if device.Token == "" || device.ID == "" {
		t.Fatalf("device response = %+v", device)
	}

	// The token authenticates against a device-only endpoint.
	statusReq := httptest.NewRequest(http.MethodGet, "/api/capture/status", nil)
	statusReq.Header.Set("Authorization", "Bearer "+device.Token)
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("capture status with paired token = %d body=%s", statusRec.Code, statusRec.Body.String())
	}

	// A second redemption of the same code is rejected.
	reused := claimPairing(t, router, minted.Code, "Second phone")
	if reused.Code != http.StatusConflict {
		t.Fatalf("reused code status = %d, want 409", reused.Code)
	}

	// An unknown code is rejected.
	unknown := claimPairing(t, router, "not-a-real-code", "Ghost phone")
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown code status = %d, want 404", unknown.Code)
	}
}

func claimPairing(t *testing.T, handler http.Handler, code, name string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"code":"` + code + `","name":"` + name + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/devices/pair/claim", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
