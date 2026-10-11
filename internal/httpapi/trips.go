package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/trips"
)

// coverAssetsPerTrip matches coverAssetsPerAlbum: the clients draw the same 2x2
// mosaic for a trip card that they draw for an album.
const coverAssetsPerTrip = 4

// ownsTrip verifies the trip exists and belongs to the caller. Mirrors
// ownsAlbum; every trip handler calls it before touching membership, so a trip
// id from another library is a 404 rather than a leak.
func (d Deps) ownsTrip(r *http.Request, tripID string) (bool, error) {
	owner, ok := d.ownerID(r)
	if !ok {
		return false, nil
	}
	var one int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT 1 FROM trips WHERE id = ? AND owner_id = ?`, tripID, owner).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// listTrips returns the owner's trips, newest first.
// @Summary List trips
// @Tags    trips
// @Produce json
// @Success 200 {object} apitypes.TripList
// @Failure 401 {object} apitypes.Error
// @Router  /api/trips [get]
func (d Deps) listTrips(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT t.id, t.name, t.name_source, t.started_at, t.ended_at,
		       t.place_city, t.place_country, COALESCE(t.cover_asset_id, ''), t.hidden,
		       (SELECT COUNT(*) FROM trip_members m
		          JOIN assets a2 ON a2.id = m.asset_id
		         WHERE m.trip_id = t.id AND m.source IN ('detected','added')
		           AND a2.deleted_at IS NULL)
		FROM trips t
		WHERE t.owner_id = ?
		ORDER BY t.started_at DESC`, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_trips_failed")
		return
	}
	defer rows.Close()

	list := make([]apitypes.Trip, 0)
	for rows.Next() {
		var t apitypes.Trip
		var cover string
		var hidden int
		if err := rows.Scan(&t.ID, &t.Name, &t.NameSource, &t.StartedAt, &t.EndedAt,
			&t.PlaceCity, &t.PlaceCountry, &cover, &hidden, &t.AssetCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan_trips_failed")
			return
		}
		t.Hidden = hidden != 0
		// An explicit cover wins; otherwise the newest members fill the mosaic.
		t.CoverAssetIDs = []string{}
		if cover != "" {
			t.CoverAssetIDs = []string{cover}
		}
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "scan_trips_failed")
		return
	}

	covers, err := d.tripCovers(r.Context(), owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_trips_failed")
		return
	}
	for i := range list {
		// Only fill in where the user has not chosen a cover themselves.
		if len(list[i].CoverAssetIDs) == 0 {
			if ids, ok := covers[list[i].ID]; ok {
				list[i].CoverAssetIDs = ids
			}
		}
	}
	writeJSON(w, http.StatusOK, apitypes.TripList{Trips: list})
}

// tripCovers returns the newest few member ids for each of the owner's trips,
// in one query rather than one per trip -- the same N+1 avoidance, and the same
// ROW_NUMBER shape, that albumCovers uses.
func (d Deps) tripCovers(ctx context.Context, owner string) (map[string][]string, error) {
	rows, err := d.DB.QueryContext(ctx, `
		SELECT trip_id, asset_id FROM (
			SELECT m.trip_id AS trip_id, ast.id AS asset_id,
			       ROW_NUMBER() OVER (
			           PARTITION BY m.trip_id
			           ORDER BY COALESCE(ast.taken_at, ast.created_at) DESC, ast.id DESC
			       ) AS rn
			FROM trip_members m
			JOIN trips t ON t.id = m.trip_id AND t.owner_id = ?
			JOIN assets ast ON ast.id = m.asset_id
			WHERE ast.deleted_at IS NULL AND ast.owner_id = ?
			  AND m.source IN ('detected','added')
		) WHERE rn <= ?
		ORDER BY trip_id, rn`, owner, owner, coverAssetsPerTrip)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	covers := make(map[string][]string)
	for rows.Next() {
		var tripID, assetID string
		if err := rows.Scan(&tripID, &assetID); err != nil {
			return nil, err
		}
		covers[tripID] = append(covers[tripID], assetID)
	}
	return covers, rows.Err()
}

// getTrip returns the trip's assets in timeline order.
// @Summary Get trip assets
// @Tags    trips
// @Produce json
// @Param   id     path  string true  "trip id"
// @Param   limit  query int    false "page size"
// @Param   cursor query string false "pagination cursor"
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/trips/{id} [get]
func (d Deps) getTrip(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsTrip(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "trip_lookup_failed")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "trip_not_found")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	limit := parseLimit(r.URL.Query().Get("limit"))
	cursor, cursorArgs, cok := requestCursor(w, r)
	if !cok {
		return
	}
	args := append([]any{id, owner}, cursorArgs...)
	args = append(args, limit+1)
	// The owner predicate is spelled out rather than inherited from the
	// ownsTrip call above. albums.go earns its guard exemption by arguing every
	// write path is owner-guarded; trip membership is also written by a
	// background worker in internal/trips, so that argument does not hold here
	// and the query carries its own scope.
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQLWithJoin(
			"JOIN trip_members tm ON tm.asset_id = a.id AND tm.source IN ('detected','added')",
			"WHERE tm.trip_id = ? AND a.owner_id = ? AND a.deleted_at IS NULL"+cursor)+" LIMIT ?",
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_trip_assets_failed")
		return
	}
	defer rows.Close()
	assets, next, err := scanAssetRows(rows, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_trip_assets_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets, NextCursor: next})
}

// patchTrip renames a trip, sets its cover, or hides it.
// @Summary Edit trip
// @Tags    trips
// @Accept  json
// @Produce json
// @Param   id   path string               true "trip id"
// @Param   body body apitypes.TripRequest true "fields to change"
// @Success 200 {object} map[string]string
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/trips/{id} [patch]
func (d Deps) patchTrip(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsTrip(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "trip_lookup_failed")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "trip_not_found")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.TripRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	sets := []string{}
	args := []any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		// Clearing the name hands the trip back to the automatic label rather
		// than leaving it permanently blank.
		source := "user"
		if name == "" {
			source = "auto"
		}
		sets = append(sets, "name = ?", "name_source = ?")
		args = append(args, name, source)
	}
	if req.CoverAssetID != nil {
		cover := strings.TrimSpace(*req.CoverAssetID)
		if cover == "" {
			sets = append(sets, "cover_asset_id = NULL")
		} else {
			owns, err := d.ownsAsset(r, cover)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "trip_cover_failed")
				return
			}
			if !owns {
				writeError(w, http.StatusBadRequest, "cover_not_found")
				return
			}
			sets = append(sets, "cover_asset_id = ?")
			args = append(args, cover)
		}
	}
	if req.Hidden != nil {
		hidden := 0
		if *req.Hidden {
			hidden = 1
		}
		sets = append(sets, "hidden = ?")
		args = append(args, hidden)
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "no_fields")
		return
	}
	args = append(args, id, owner)
	if _, err := d.DB.ExecContext(r.Context(),
		`UPDATE trips SET `+strings.Join(sets, ", ")+` WHERE id = ? AND owner_id = ?`, args...); err != nil {
		writeError(w, http.StatusInternalServerError, "trip_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// addTripAssets adds photos the user picked to a trip.
// @Summary Add assets to trip
// @Tags    trips
// @Accept  json
// @Produce json
// @Param   id   path string            true "trip id"
// @Param   body body apitypes.AssetIDs true "asset ids"
// @Success 200 {object} map[string]int
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/trips/{id}/assets [post]
func (d Deps) addTripAssets(w http.ResponseWriter, r *http.Request) {
	d.editTripMembers(w, r, "added")
}

// removeTripAssets drops photos from a trip without deleting them.
// @Summary Remove assets from trip
// @Tags    trips
// @Accept  json
// @Produce json
// @Param   id   path string            true "trip id"
// @Param   body body apitypes.AssetIDs true "asset ids"
// @Success 200 {object} map[string]int
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/trips/{id}/assets [delete]
func (d Deps) removeTripAssets(w http.ResponseWriter, r *http.Request) {
	d.editTripMembers(w, r, "removed")
}

// editTripMembers backs both add and remove. They differ only in the source
// they write, because removal is a tombstone rather than a deletion -- see
// writeTripMembers.
func (d Deps) editTripMembers(w http.ResponseWriter, r *http.Request, source string) {
	id := chi.URLParam(r, "id")
	ok, err := d.ownsTrip(r, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "trip_not_found")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.AssetIDs
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "too_many_ids")
		return
	}
	changed, err := d.writeTripMembers(r.Context(), id, owner, source, req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "trip_members_failed")
		return
	}
	key := "added"
	if source == "removed" {
		key = "removed"
	}
	writeJSON(w, http.StatusOK, map[string]int{key: changed})
}

// writeTripMembers records a user's membership decision.
//
// One transaction and prepared statements, like linkAlbumAssets, for the same
// reason: one tap can carry a thousand ids, and a row-per-transaction loop
// turns that into a thousand WAL commits.
//
// The one deliberate divergence from albums is ON CONFLICT DO UPDATE rather
// than INSERT OR IGNORE. Album membership is binary so a conflict is genuinely
// a no-op, but a trip row already exists for any asset detection placed here or
// the user previously removed -- and re-adding a removed photo must FLIP that
// tombstone. OR IGNORE would silently do nothing, which is the bug this shape
// exists to prevent.
func (d Deps) writeTripMembers(ctx context.Context, tripID, owner, source string, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("httpapi: begin trip members: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	// The EXISTS guard is the owner scope on a write a device token can make:
	// without it any asset id could be attached to the caller's trip.
	upsert, err := tx.PrepareContext(ctx, `
		INSERT INTO trip_members (trip_id, asset_id, source)
		SELECT ?, ?, ?
		WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND owner_id = ?)
		ON CONFLICT(trip_id, asset_id) DO UPDATE SET source = excluded.source
		WHERE trip_members.source <> excluded.source`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare trip member upsert: %w", err)
	}
	defer upsert.Close()

	logChange, err := tx.PrepareContext(ctx,
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', ?)`)
	if err != nil {
		return 0, fmt.Errorf("httpapi: prepare trip member log: %w", err)
	}
	defer logChange.Close()

	changed := 0
	for _, assetID := range ids {
		res, err := upsert.ExecContext(ctx, tripID, assetID, source, assetID, owner)
		if err != nil {
			return 0, fmt.Errorf("httpapi: trip member write: %w", err)
		}
		// Only a row that actually moved counts, and only it is worth a
		// change_log entry -- re-removing something already removed must not
		// wake every device's delta sync.
		if n, _ := res.RowsAffected(); n > 0 {
			changed++
			if _, err := logChange.ExecContext(ctx, assetID, owner); err != nil {
				return 0, fmt.Errorf("httpapi: trip member log: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("httpapi: commit trip members: %w", err)
	}
	return changed, nil
}

// runTrips recomputes the caller's trips on demand.
//
// Synchronous, and deliberately so: detection is one indexed query plus
// in-memory clustering, there is no durable run table to report progress
// through, and a detached goroutine here would be the same unbounded
// per-request worker the thumbnail work already flagged as a follow-up. It runs
// automatically at startup and after every import, so this endpoint is a
// convenience rather than the normal path.
// @Summary Recompute trips
// @Tags    trips
// @Produce json
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Router  /api/trips/run [post]
func (d Deps) runTrips(w http.ResponseWriter, r *http.Request) {
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := trips.DetectOwner(r.Context(), d.DB, owner); err != nil {
		writeError(w, http.StatusInternalServerError, "trip_detect_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
