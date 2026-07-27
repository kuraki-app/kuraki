package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// newSettingsTestRouter mirrors newAuthTestRouter (auth_test.go) but also
// wires a config.Store, following this codebase's convention of a small
// per-file router constructor (see favorites_device_test.go's
// deviceFavoriteRouter) rather than growing a shared one with optional parts.
func newSettingsTestRouter(t *testing.T, envPresent map[string]bool) (http.Handler, *sql.DB, *config.Store) {
	t.Helper()
	ctx := context.Background()
	dataDir := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(dataDir, "kuraki.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store, err := storage.NewFS(dataDir)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	if envPresent == nil {
		envPresent = map[string]bool{}
	}
	settings := config.NewStore(config.Default(), envPresent, map[string]string{})
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Settings: settings, Logger: slog.Default()})
	return router, database, settings
}

func TestGetSettingsRequiresOwner(t *testing.T) {
	router, _, _ := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := getJSON(t, router, "/api/settings", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner GET /api/settings = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.SettingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Settings) != len(config.Catalog) {
		t.Fatalf("settings count = %d, want %d", len(resp.Settings), len(config.Catalog))
	}
}

func TestGetSettingsDeviceTokenRejected(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	rec := deviceJSON(t, router, http.MethodGet, "/api/settings", token, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("device token on /api/settings = %d, want 403", rec.Code)
	}
}

func TestGetSettingsMasksMetricsToken(t *testing.T) {
	router, database, settings := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"metrics_token": "super-secret"}, cookie)
	_ = database
	_ = settings

	rec := getJSON(t, router, "/api/settings", cookie)
	var resp apitypes.SettingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	for _, s := range resp.Settings {
		if s.Key == "metrics_token" {
			if s.Value != "" {
				t.Fatalf("metrics_token value must be masked, got %q", s.Value)
			}
			if !s.IsSet {
				t.Fatal("metrics_token IsSet must be true once configured")
			}
			return
		}
	}
	t.Fatal("metrics_token not found in settings list")
}

func TestPatchSettingsAppliesLiveKey(t *testing.T) {
	router, _, settings := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"trash_retention_days": "14"}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Applied) != 1 || resp.Applied[0] != "trash_retention_days" {
		t.Fatalf("applied = %v, want [trash_retention_days]", resp.Applied)
	}
	if len(resp.PendingRestart) != 0 {
		t.Fatalf("pending_restart = %v, want none", resp.PendingRestart)
	}
	if got := settings.Current().TrashRetentionDays; got != 14 {
		t.Fatalf("live key must update the Store immediately, got %d", got)
	}
}

func TestPatchSettingsFlagsRestartKey(t *testing.T) {
	router, _, settings := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"thumbnail_size": "1024"}, cookie)
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.PendingRestart) != 1 || resp.PendingRestart[0] != "thumbnail_size" {
		t.Fatalf("pending_restart = %v, want [thumbnail_size]", resp.PendingRestart)
	}
	if got := settings.Current().ThumbnailSize; got != 1024 {
		t.Fatalf("Current() should show the saved value even though it's restart-pending, got %d", got)
	}
	_ = rec
}

func TestPatchSettingsRejectsOutOfBounds(t *testing.T) {
	router, _, _ := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"thumbnail_size": "10"}, cookie)
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Rejected) != 1 || resp.Rejected[0].Key != "thumbnail_size" {
		t.Fatalf("rejected = %v, want thumbnail_size rejected", resp.Rejected)
	}
}

func TestPatchSettingsRejectsPinnedKey(t *testing.T) {
	router, _, _ := newSettingsTestRouter(t, map[string]bool{"KURAKI_TRASH_RETENTION_DAYS": true})
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"trash_retention_days": "5"}, cookie)
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Rejected) != 1 || resp.Rejected[0].Error != "pinned_by_env" {
		t.Fatalf("rejected = %v, want trash_retention_days pinned_by_env", resp.Rejected)
	}
}

func TestPatchSettingsRejectsUnknownKey(t *testing.T) {
	router, _, _ := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"nonsense": "x"}, cookie)
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Rejected) != 1 || resp.Rejected[0].Error != "unknown_setting" {
		t.Fatalf("rejected = %v, want nonsense unknown_setting", resp.Rejected)
	}
}

func TestPatchSettingsRejectsUnwritableBackupDir(t *testing.T) {
	router, _, _ := newSettingsTestRouter(t, nil)
	cookie := setupOwner(t, router, "correct horse")

	rec := patchJSON(t, router, "/api/settings", apitypes.SettingsPatchRequest{"backup_dir": "/does/not/exist/at/all"}, cookie)
	var resp apitypes.SettingsPatchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Rejected) != 1 || resp.Rejected[0].Key != "backup_dir" {
		t.Fatalf("rejected = %v, want backup_dir rejected", resp.Rejected)
	}
}
