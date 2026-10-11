// Package trips groups assets captured away from home over a continuous
// stretch of time, so the timeline gains a layer between "a day" and "an album
// someone had to build by hand".
//
// Detection owns baseline membership and is safe to re-run after every import:
// a Google Takeout dump of 2019 landing next week must be able to join the trip
// it belongs to. The user owns naming and may add or remove photos, and both
// survive a recompute — see the overlay rule on trip_members in migration
// 00028, which is what makes re-running safe.
//
// The detection SQL lives here rather than in internal/httpapi, so it is
// outside ownerscope_guard_test.go's reach (the guard scans that package only).
// Every query below is therefore owner-scoped by hand and pinned by
// TestDetectIsOwnerScoped, the same arrangement thumbs.Get uses.
package trips

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
)

// AlgorithmVersion is stamped on every trip a run creates. Bumping it is how a
// future change to the clustering rules announces that existing rows were
// produced by different logic.
const AlgorithmVersion = 1

const (
	// GapHours ends a cluster: a break longer than this is a different trip.
	// Twenty hours rather than twenty-four so an early start on the last
	// morning does not merge into the day after a flight home.
	GapHours = 20

	// RadiusKM ends a cluster when a photo lands further than this from the
	// running centroid, for the case two trips run back to back with no gap.
	RadiusKM = 60

	// MinAssets is the floor for a cluster to be a trip at all.
	MinAssets = 8

	// HomeRadiusKM decides "away". A cluster inside this distance of the
	// library's home point is ordinary life, however many photos it holds.
	HomeRadiusKM = 50
)

// Trip is one detected grouping. The label is deliberately NOT stored: the
// server keeps raw facts and shared/trips.ts formats them, so web and mobile
// cannot disagree about how a trip is named.
type Trip struct {
	ID           string
	Name         string
	NameSource   string
	StartedAt    string
	EndedAt      string
	PlaceCity    string
	PlaceCountry string
	AssetCount   int
	Hidden       bool
	CoverAssetID string
}

// asset is one candidate row, already parsed.
type asset struct {
	id        string
	takenAt   time.Time
	takenText string
	lat, lon  float64
	hasGPS    bool
	city      string
	country   string
}

// Detect recomputes trips for every owner. Safe to run repeatedly, and called
// after an import job lands rows (see internal/queue) as well as at startup.
func Detect(ctx context.Context, db *sql.DB) error {
	owners, err := ownerIDs(ctx, db)
	if err != nil {
		return fmt.Errorf("trips: list owners: %w", err)
	}
	for _, owner := range owners {
		if err := DetectOwner(ctx, db, owner); err != nil {
			return fmt.Errorf("trips: detect for owner: %w", err)
		}
	}
	return nil
}

func ownerIDs(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT id FROM users WHERE disabled_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DetectOwner recomputes one owner's trips. Exported so a test can drive a
// single library without inventing others.
func DetectOwner(ctx context.Context, db *sql.DB, ownerID string) error {
	assets, err := loadAssets(ctx, db, ownerID)
	if err != nil {
		return fmt.Errorf("trips: load assets: %w", err)
	}
	home, hasHome := homePoint(assets)
	clusters := clusterAssets(assets)

	kept := make([][]asset, 0, len(clusters))
	for _, c := range clusters {
		if qualifies(c, home, hasHome) {
			kept = append(kept, c)
		}
	}
	return persist(ctx, db, ownerID, kept)
}

// loadAssets reads the owner's dated, live assets in capture order.
//
// taken_at must be present: falling back to created_at would cluster by IMPORT
// time, so one Takeout dump would become a single enormous "trip". An undated
// photo is not part of any trip, which is the same call shared/memories.ts
// makes for the same reason.
func loadAssets(ctx context.Context, db *sql.DB, ownerID string) ([]asset, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, taken_at, gps_lat, gps_lon,
		       COALESCE(place_city, ''), COALESCE(place_country, '')
		FROM assets
		WHERE owner_id = ?
		  AND deleted_at IS NULL
		  AND archived = 0
		  AND hidden = 0
		  AND taken_at IS NOT NULL
		ORDER BY taken_at, id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []asset
	for rows.Next() {
		var a asset
		var lat, lon sql.NullFloat64
		if err := rows.Scan(&a.id, &a.takenText, &lat, &lon, &a.city, &a.country); err != nil {
			return nil, err
		}
		t, ok := parseTime(a.takenText)
		if !ok {
			// A row whose timestamp cannot be parsed cannot be placed on the
			// timeline, so it cannot belong to a trip either.
			continue
		}
		a.takenAt = t
		if lat.Valid && lon.Valid {
			a.lat, a.lon, a.hasGPS = lat.Float64, lon.Float64, true
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// parseTime accepts the timestamp shapes the importer writes.
func parseTime(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// homePoint is the median GPS position of the whole library — a cheap stand-in
// for "where this person lives" that needs no new concept, no setting, and no
// user input. The median rather than the mean so a single fortnight abroad
// cannot drag home across a continent.
func homePoint(assets []asset) (point, bool) {
	lats := make([]float64, 0, len(assets))
	lons := make([]float64, 0, len(assets))
	for _, a := range assets {
		if a.hasGPS {
			lats = append(lats, a.lat)
			lons = append(lons, a.lon)
		}
	}
	if len(lats) == 0 {
		return point{}, false
	}
	sort.Float64s(lats)
	sort.Float64s(lons)
	return point{lat: lats[len(lats)/2], lon: lons[len(lons)/2]}, true
}

type point struct{ lat, lon float64 }

// clusterAssets cuts the capture-ordered list into runs of continuous activity.
// Input must be sorted by taken_at.
func clusterAssets(assets []asset) [][]asset {
	var out [][]asset
	var current []asset
	var sumLat, sumLon float64
	var gpsCount int

	flush := func() {
		if len(current) > 0 {
			out = append(out, current)
		}
		current, sumLat, sumLon, gpsCount = nil, 0, 0, 0
	}

	for _, a := range assets {
		if len(current) > 0 {
			prev := current[len(current)-1]
			gap := a.takenAt.Sub(prev.takenAt)
			farInTime := gap > GapHours*time.Hour

			// The centroid comparison only speaks when both sides have GPS.
			// A GPS-less photo must never split a trip: most screenshots and
			// many imported originals carry no coordinates at all.
			farInSpace := false
			if a.hasGPS && gpsCount > 0 {
				c := point{lat: sumLat / float64(gpsCount), lon: sumLon / float64(gpsCount)}
				farInSpace = distanceKM(c.lat, c.lon, a.lat, a.lon) > RadiusKM
			}
			if farInTime || farInSpace {
				flush()
			}
		}
		current = append(current, a)
		if a.hasGPS {
			sumLat += a.lat
			sumLon += a.lon
			gpsCount++
		}
	}
	flush()
	return out
}

// qualifies decides whether a run of activity reads as a trip rather than a
// busy weekend at home.
func qualifies(c []asset, home point, hasHome bool) bool {
	if len(c) < MinAssets {
		return false
	}
	// Away from home is the strongest signal, when the data supports it.
	if hasHome {
		located := false
		for _, a := range c {
			if !a.hasGPS {
				continue
			}
			located = true
			if distanceKM(home.lat, home.lon, a.lat, a.lon) > HomeRadiusKM {
				return true
			}
		}
		// Every located photo sits near home, so this is ordinary life and
		// duration must NOT rescue it. A continuous run of photos at home
		// spans two calendar days without trying -- that is a long weekend in
		// the kitchen, not a trip. Letting the fallback below see a located
		// cluster is what turned every fixture's 40-photo home block into a
		// "trip", and it failed as nine separate tests rather than one.
		if located {
			return false
		}
	}
	// Nothing to judge by: fall back to duration, so a library carrying no GPS
	// anywhere still gets trips.
	return distinctDays(c) >= 2
}

func distinctDays(c []asset) int {
	seen := map[string]bool{}
	for _, a := range c {
		seen[a.takenAt.Format("2006-01-02")] = true
	}
	return len(seen)
}

// distanceKM is the equirectangular approximation, the same form internal/geo
// uses inline for its nearest-city search. Exact great-circle distance buys
// nothing at the scale of a 60km threshold.
func distanceKM(aLat, aLon, bLat, bLon float64) float64 {
	const earthKM = 6371.0
	cosLat := math.Cos(aLat * math.Pi / 180)
	dy := (bLat - aLat) * math.Pi / 180
	dx := (bLon - aLon) * math.Pi / 180 * cosLat
	return earthKM * math.Sqrt(dy*dy+dx*dx)
}

// existingTrip is a row already in the database, with enough context to decide
// whether a recompute may delete it.
type existingTrip struct {
	id          string
	startedAt   time.Time
	endedAt     time.Time
	nameSource  string
	hasUserRows bool
	claimed     bool
}

// persist reconciles freshly detected clusters against the trips already
// stored, then rewrites detected membership.
func persist(ctx context.Context, db *sql.DB, ownerID string, clusters [][]asset) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("trips: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	existing, err := loadExisting(ctx, tx, ownerID)
	if err != nil {
		return err
	}

	for _, c := range clusters {
		start, end := c[0].takenAt, c[len(c)-1].takenAt
		city, country := dominantPlace(c)

		id, ok := claimTrip(existing, start, end)
		if ok {
			// An existing trip absorbs this cluster. Its range and place are
			// refreshed; its name is left alone when the user set it.
			if _, err := tx.ExecContext(ctx, `
				UPDATE trips SET started_at = ?, ended_at = ?, place_city = ?, place_country = ?,
				                 algorithm_version = ?
				WHERE id = ? AND owner_id = ?`,
				rfc(start), rfc(end), city, country, AlgorithmVersion, id, ownerID); err != nil {
				return fmt.Errorf("trips: update trip: %w", err)
			}
		} else {
			newID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("trips: new id: %w", err)
			}
			id = newID.String()
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO trips (id, owner_id, started_at, ended_at, place_city, place_country, algorithm_version)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				id, ownerID, rfc(start), rfc(end), city, country, AlgorithmVersion); err != nil {
				return fmt.Errorf("trips: insert trip: %w", err)
			}
		}
		if err := writeMembers(ctx, tx, id, c); err != nil {
			return err
		}
	}

	// A trip nothing claimed is stale. It is removed only when it carries no
	// user decision — a renamed trip, or one the user edited the membership of,
	// becomes theirs to keep or delete.
	for _, e := range existing {
		if e.claimed || e.nameSource == "user" || e.hasUserRows {
			continue
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM trips WHERE id = ? AND owner_id = ?`, e.id, ownerID); err != nil {
			return fmt.Errorf("trips: delete stale trip: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("trips: commit: %w", err)
	}
	return nil
}

func loadExisting(ctx context.Context, tx *sql.Tx, ownerID string) ([]*existingTrip, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT t.id, t.started_at, t.ended_at, t.name_source,
		       EXISTS (SELECT 1 FROM trip_members m
		                WHERE m.trip_id = t.id AND m.source IN ('added','removed'))
		FROM trips t WHERE t.owner_id = ?`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("trips: load existing: %w", err)
	}
	defer rows.Close()
	var out []*existingTrip
	for rows.Next() {
		var e existingTrip
		var start, end string
		var userRows int
		if err := rows.Scan(&e.id, &start, &end, &e.nameSource, &userRows); err != nil {
			return nil, fmt.Errorf("trips: scan existing: %w", err)
		}
		e.startedAt, _ = parseTime(start)
		e.endedAt, _ = parseTime(end)
		e.hasUserRows = userRows != 0
		out = append(out, &e)
	}
	return out, rows.Err()
}

// claimTrip matches a freshly detected cluster to the existing trip it overlaps
// most, so a user's name and edits stay attached to the same stretch of time
// across recomputes.
//
// Overlap is measured against the SHORTER of the two spans: a trip that grows
// when late photos import still recognises itself, which is the whole point of
// re-running detection. Half is the bar — below that the cluster is a different
// trip that merely brushes this one.
func claimTrip(existing []*existingTrip, start, end time.Time) (string, bool) {
	best := ""
	bestRatio := 0.0
	for _, e := range existing {
		if e.claimed {
			continue
		}
		overlap := minTime(end, e.endedAt).Sub(maxTime(start, e.startedAt))
		if overlap <= 0 {
			continue
		}
		shorter := end.Sub(start)
		if other := e.endedAt.Sub(e.startedAt); other < shorter {
			shorter = other
		}
		ratio := 1.0
		// Two instants (a burst inside one second) overlap completely or not
		// at all; guarding the divide keeps that from being a NaN.
		if shorter > 0 {
			ratio = float64(overlap) / float64(shorter)
		}
		if ratio >= 0.5 && ratio > bestRatio {
			best, bestRatio = e.id, ratio
		}
	}
	if best == "" {
		return "", false
	}
	for _, e := range existing {
		if e.id == best {
			e.claimed = true
		}
	}
	return best, true
}

// writeMembers replaces detected membership and leaves user rows untouched.
//
// The INSERT is OR IGNORE, and that is the overlay rule doing its work: an
// asset the user added or removed already holds the (trip_id, asset_id) row, so
// detection cannot overwrite the decision. See migration 00028.
func writeMembers(ctx context.Context, tx *sql.Tx, tripID string, c []asset) error {
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM trip_members WHERE trip_id = ? AND source = 'detected'`, tripID); err != nil {
		return fmt.Errorf("trips: clear detected members: %w", err)
	}
	insert, err := tx.PrepareContext(ctx,
		`INSERT OR IGNORE INTO trip_members (trip_id, asset_id, source) VALUES (?, ?, 'detected')`)
	if err != nil {
		return fmt.Errorf("trips: prepare member insert: %w", err)
	}
	defer insert.Close()
	for _, a := range c {
		if _, err := insert.ExecContext(ctx, tripID, a.id); err != nil {
			return fmt.Errorf("trips: insert member: %w", err)
		}
	}
	return nil
}

// dominantPlace is the most common non-empty city among the members, with the
// country that travels with it. Ties break toward the earlier photo, so the
// label favours where the trip began.
func dominantPlace(c []asset) (string, string) {
	counts := map[string]int{}
	country := map[string]string{}
	order := []string{}
	for _, a := range c {
		if a.city == "" {
			continue
		}
		if _, seen := counts[a.city]; !seen {
			order = append(order, a.city)
			country[a.city] = a.country
		}
		counts[a.city]++
	}
	best, bestN := "", 0
	for _, city := range order {
		if counts[city] > bestN {
			best, bestN = city, counts[city]
		}
	}
	return best, country[best]
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
