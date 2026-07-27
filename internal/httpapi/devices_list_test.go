package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

func TestListDevicesReturnsOnlyOwnersUnrevoked(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	registerTestDevice(t, router, cookie) // one active device

	// A second owner's device must never appear.
	otherOwner := secondOwner(t, database)
	if _, err := database.Exec(
		`INSERT INTO devices (id, owner_id, name, token_hash, last_seen_at) VALUES ('other-device', ?, 'Other phone', 'x', NULL)`,
		otherOwner); err != nil {
		t.Fatal(err)
	}

	rec := getJSON(t, router, "/api/devices", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.DeviceList
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Devices) != 1 {
		t.Fatalf("devices = %v, want exactly the caller's own device", resp.Devices)
	}
	if resp.Devices[0].Name != "Test phone" {
		t.Fatalf("device name = %q, want 'Test phone'", resp.Devices[0].Name)
	}
}

func TestListDevicesExcludesRevoked(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)
	registerTestDevice(t, router, cookie)
	if _, err := database.Exec(`UPDATE devices SET revoked_at = '2026-01-01T00:00:00Z' WHERE owner_id = (SELECT id FROM users LIMIT 1)`); err != nil {
		t.Fatal(err)
	}

	rec := getJSON(t, router, "/api/devices", cookie)
	var resp apitypes.DeviceList
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Devices) != 0 {
		t.Fatalf("devices = %v, want none (all revoked)", resp.Devices)
	}
}

func TestListDevicesNeverExposesToken(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	registerTestDevice(t, router, cookie)

	rec := getJSON(t, router, "/api/devices", cookie)
	if body := rec.Body.String(); containsTokenLikeField(body) {
		t.Fatalf("response must never include token_hash or token, body=%s", body)
	}
}

func containsTokenLikeField(body string) bool {
	var raw map[string]any
	if json.Unmarshal([]byte(body), &raw) != nil {
		return false
	}
	devices, _ := raw["devices"].([]any)
	for _, d := range devices {
		m, _ := d.(map[string]any)
		if _, ok := m["token"]; ok {
			return true
		}
		if _, ok := m["token_hash"]; ok {
			return true
		}
	}
	return false
}

func TestListDevicesDeviceTokenRejected(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	rec := deviceJSON(t, router, http.MethodGet, "/api/devices", token, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("device token on /api/devices = %d, want 403", rec.Code)
	}
}
