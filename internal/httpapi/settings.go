package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"

	"github.com/kuraki-app/kuraki/internal/config"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/ocr"
	"github.com/kuraki-app/kuraki/internal/serversettings"
)

// getSettings reports every writable server setting's current value,
// default, and metadata (type, bounds, apply mode, whether the environment
// pins it), plus which restart-mode keys have a saved value the running
// process has not picked up yet.
// @Summary List server settings
// @Tags    admin
// @Produce json
// @Success 200 {object} apitypes.SettingsResponse
// @Failure 401 {object} apitypes.Error
// @Failure 403 {object} apitypes.Error
// @Router  /api/settings [get]
func (d Deps) getSettings(w http.ResponseWriter, r *http.Request) {
	current := d.Settings.Current()
	booted := d.Settings.Booted()
	defaults := config.Default()
	pinned := map[string]bool{}
	for _, k := range config.PinnedKeys(d.Settings.EnvPresent()) {
		pinned[k] = true
	}

	settings := make([]apitypes.SettingInfo, 0, len(config.Catalog))
	for _, desc := range config.Catalog {
		info := apitypes.SettingInfo{
			Key:         string(desc.Key),
			Default:     config.FieldString(defaults, desc.Key),
			Type:        string(desc.Type),
			Unit:        desc.Unit,
			Apply:       string(desc.Apply),
			PinnedByEnv: pinned[string(desc.Key)],
			EnvVar:      desc.EnvVar,
			Min:         desc.Min,
			Max:         desc.Max,
			Secret:      desc.Secret,
		}
		value := config.FieldString(current, desc.Key)
		if desc.Secret {
			info.IsSet = value != ""
			info.Value = ""
		} else {
			info.Value = value
		}
		settings = append(settings, info)
	}

	writeJSON(w, http.StatusOK, apitypes.SettingsResponse{
		Version:        d.Version,
		RestartPending: config.RestartPending(current, booted),
		Settings:       settings,
	})
}

// patchSettings validates and saves a partial set of settings. Each key
// succeeds or fails independently: a form save is never all-or-nothing.
// Unknown keys, keys pinned by the environment, and out-of-bounds values are
// reported in "rejected" rather than aborting the whole request.
// @Summary Update server settings
// @Tags    admin
// @Accept  json
// @Produce json
// @Param   body body apitypes.SettingsPatchRequest true "partial key/value map"
// @Success 200 {object} apitypes.SettingsPatchResponse
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 403 {object} apitypes.Error
// @Router  /api/settings [patch]
func (d Deps) patchSettings(w http.ResponseWriter, r *http.Request) {
	var req apitypes.SettingsPatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	pinned := map[string]bool{}
	for _, k := range config.PinnedKeys(d.Settings.EnvPresent()) {
		pinned[k] = true
	}

	resp := apitypes.SettingsPatchResponse{}
	toSave := map[string]string{}
	for key, raw := range req {
		desc, ok := config.CatalogKey(key)
		if !ok {
			resp.Rejected = append(resp.Rejected, apitypes.SettingRejection{Key: key, Error: "unknown_setting"})
			continue
		}
		if pinned[key] {
			resp.Rejected = append(resp.Rejected, apitypes.SettingRejection{Key: key, Error: "pinned_by_env"})
			continue
		}
		canon, err := config.ValidateSetting(desc.Key, raw)
		if err != nil {
			resp.Rejected = append(resp.Rejected, apitypes.SettingRejection{Key: key, Error: err.Error()})
			continue
		}
		if desc.Key == config.KeyBackupDir && canon != "" {
			if err := checkBackupDirWritable(canon); err != nil {
				resp.Rejected = append(resp.Rejected, apitypes.SettingRejection{Key: key, Error: err.Error()})
				continue
			}
		}
		if desc.Key == config.KeyOCREnabled && canon == "1" && !ocr.Available() {
			resp.Warnings = append(resp.Warnings, apitypes.SettingWarning{Key: key, Warning: "tesseract not found on PATH"})
		}
		toSave[key] = canon
	}

	for key, canon := range toSave {
		if err := serversettings.Save(r.Context(), d.DB, key, canon); err != nil {
			writeError(w, http.StatusInternalServerError, "settings_save_failed")
			return
		}
		if desc, ok := config.CatalogKey(key); ok && desc.Apply == config.ApplyLive {
			resp.Applied = append(resp.Applied, key)
		}
	}
	sort.Strings(resp.Applied)

	rows, err := serversettings.LoadAll(r.Context(), d.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "settings_save_failed")
		return
	}
	newCfg := d.Settings.Refresh(rows)
	resp.PendingRestart = config.RestartPending(newCfg, d.Settings.Booted())

	writeJSON(w, http.StatusOK, resp)
}

// checkBackupDirWritable confirms dir exists and can be written to, so a
// saved backup_dir never silently fails every scheduled run. This is the one
// piece of settings validation that needs the filesystem, which is why it
// lives here rather than in the pure internal/config.ValidateSetting.
func checkBackupDirWritable(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("directory does not exist")
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory")
	}
	f, err := os.CreateTemp(dir, ".kuraki-write-test-*")
	if err != nil {
		return fmt.Errorf("directory is not writable")
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return nil
}
