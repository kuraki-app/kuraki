package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/geo"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// patchAsset edits a single asset's capture date, location, or caption. Changing
// the location re-runs offline reverse geocoding; any change refreshes search.
// @Summary Edit asset
// @Tags    assets
// @Accept  json
// @Produce json
// @Param   id   path string             true "asset id"
// @Param   body body apitypes.AssetPatch true "fields to change"
// @Success 200 {object} apitypes.Asset
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/assets/{id} [patch]
func (d Deps) patchAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var p apitypes.AssetPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	var takenAt, description sql.NullString
	var lat, lon sql.NullFloat64
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT taken_at, description, gps_lat, gps_lon FROM assets WHERE id = ? AND deleted_at IS NULL`,
		id).Scan(&takenAt, &description, &lat, &lon)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup_failed")
		return
	}

	if p.TakenAt != nil {
		if *p.TakenAt == "" {
			takenAt = sql.NullString{}
		} else if _, err := time.Parse(time.RFC3339, *p.TakenAt); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_date")
			return
		} else {
			takenAt = sql.NullString{String: *p.TakenAt, Valid: true}
		}
	}
	if p.Description != nil {
		description = sql.NullString{String: *p.Description, Valid: *p.Description != ""}
	}

	gpsChanged := false
	placeCity, placeCountry := "", ""
	if p.ClearGPS {
		lat, lon = sql.NullFloat64{}, sql.NullFloat64{}
		gpsChanged = true
	} else if p.GPSLat != nil && p.GPSLon != nil {
		lat = sql.NullFloat64{Float64: *p.GPSLat, Valid: true}
		lon = sql.NullFloat64{Float64: *p.GPSLon, Valid: true}
		gpsChanged = true
		if pl, ok := geo.Reverse(*p.GPSLat, *p.GPSLon); ok {
			placeCity, placeCountry = pl.City, pl.Country
		}
	}

	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed")
		return
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(r.Context(),
		`UPDATE assets SET taken_at = ?, description = ? WHERE id = ? AND owner_id = ?`,
		nsAny(takenAt), nsAny(description), id, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	if gpsChanged {
		if _, err := tx.ExecContext(r.Context(),
			`UPDATE assets SET gps_lat = ?, gps_lon = ?, place_city = ?, place_country = ? WHERE id = ? AND owner_id = ?`,
			nfAny(lat), nfAny(lon), emptyToNil(placeCity), emptyToNil(placeCountry), id, owner); err != nil {
			writeError(w, http.StatusInternalServerError, "update_failed")
			return
		}
	}
	if err := rebuildAssetFTS(r.Context(), tx, id); err != nil {
		writeError(w, http.StatusInternalServerError, "update_fts_failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed")
		return
	}

	d.logAssetChange(r.Context(), id, owner, "update")

	row, err := d.lookupAsset(r, id)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
		return
	}
	writeJSON(w, http.StatusOK, row.toDTO())
}

// shiftTime shifts the capture time of many assets by a fixed offset, for fixing
// wrong camera timezones on a batch of imports.
// @Summary Shift capture time
// @Tags    assets
// @Accept  json
// @Produce json
// @Param   body body apitypes.ShiftRequest true "ids + minute offset"
// @Success 200 {object} map[string]int
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/assets/shift-time [post]
func (d Deps) shiftTime(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.ShiftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "invalid_ids")
		return
	}
	if req.Minutes == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"updated": 0})
		return
	}
	modifier := fmt.Sprintf("%+d minutes", req.Minutes)

	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "shift_failed")
		return
	}
	defer tx.Rollback()

	updated := 0
	shiftedIDs := make([]string, 0, len(req.IDs))
	for _, id := range req.IDs {
		res, err := tx.ExecContext(r.Context(), `
			UPDATE assets
			SET taken_at = strftime('%Y-%m-%dT%H:%M:%fZ', taken_at, ?)
			WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND taken_at IS NOT NULL`, modifier, id, owner)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "shift_failed")
			return
		}
		if n, _ := res.RowsAffected(); n > 0 {
			if err := rebuildAssetFTS(r.Context(), tx, id); err != nil {
				writeError(w, http.StatusInternalServerError, "shift_fts_failed")
				return
			}
			updated++
			shiftedIDs = append(shiftedIDs, id)
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "shift_failed")
		return
	}
	// Logged only after a successful commit — logAssetChange writes via d.DB,
	// outside this transaction, so logging inside the loop (before commit)
	// would leave change_log rows for updates a later rollback undid.
	for _, id := range shiftedIDs {
		d.logAssetChange(r.Context(), id, owner, "update")
	}
	writeJSON(w, http.StatusOK, map[string]int{"updated": updated})
}

// rebuildAssetFTS refreshes the search row for one asset from its current values.
func rebuildAssetFTS(ctx context.Context, tx *sql.Tx, id string) error {
	var filename, camera string
	var takenAt, desc, ocr sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT filename, camera_model, taken_at, description, ocr_text FROM assets WHERE id = ?`, id).
		Scan(&filename, &camera, &takenAt, &desc, &ocr); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM assets_fts WHERE asset_id = ?`, id); err != nil {
		return err
	}
	takenText := ""
	if takenAt.Valid && len(takenAt.String) >= 10 {
		takenText = takenAt.String[:10]
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO assets_fts (asset_id, filename, camera_model, taken_text, description, ocr_text) VALUES (?, ?, ?, ?, ?, ?)`,
		id, filename, camera, takenText, desc.String, ocr.String)
	return err
}

func nsAny(v sql.NullString) any {
	if v.Valid {
		return v.String
	}
	return nil
}
func nfAny(v sql.NullFloat64) any {
	if v.Valid {
		return v.Float64
	}
	return nil
}
func emptyToNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}
