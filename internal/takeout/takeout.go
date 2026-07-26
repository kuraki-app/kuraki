// Package takeout reads Google Takeout sidecar metadata so a photo library
// exported from Google Photos keeps its capture dates, locations, captions, and
// favorites — information Takeout stores in JSON sidecars rather than in the
// image files themselves.
package takeout

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kuraki-app/kuraki/internal/domain"
)

// Metadata is the subset of a Takeout sidecar Kuraki uses. It is an alias for
// the shared carrier every external-metadata source speaks, so a Resolver
// satisfies importer.MetadataProvider without an adapter. Takeout populates
// only the capture time, location, caption, and favorite flag; the remaining
// fields stay zero because Takeout does not export them.
type Metadata = domain.ExternalMetadata

type geo struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type sidecar struct {
	Title          string `json:"title"`
	Description    string `json:"description"`
	PhotoTakenTime struct {
		Timestamp string `json:"timestamp"`
	} `json:"photoTakenTime"`
	GeoData     geo  `json:"geoData"`
	GeoDataExif geo  `json:"geoDataExif"`
	Favorited   bool `json:"favorited"`
}

// Resolver finds and caches Takeout sidecars, tolerating Google's several sidecar
// naming conventions (including truncated "supplemental-metadata" names) by
// falling back to a per-directory index keyed on the sidecar's "title" field,
// which holds the original media filename.
type Resolver struct {
	dirIndex map[string]map[string]Metadata
}

func NewResolver() *Resolver {
	return &Resolver{dirIndex: make(map[string]map[string]Metadata)}
}

// Lookup returns sidecar metadata for a media file, if a sidecar exists.
func (r *Resolver) Lookup(mediaPath string) (Metadata, bool) {
	// Fast path: the common exact sidecar names.
	for _, cand := range []string{
		mediaPath + ".json",
		mediaPath + ".supplemental-metadata.json",
	} {
		if m, _, ok := parse(cand); ok {
			return m, true
		}
	}
	// Fallback: match by the sidecar's title field within the directory.
	idx := r.index(filepath.Dir(mediaPath))
	if m, ok := idx[filepath.Base(mediaPath)]; ok {
		return m, true
	}
	return Metadata{}, false
}

func (r *Resolver) index(dir string) map[string]Metadata {
	if idx, ok := r.dirIndex[dir]; ok {
		return idx
	}
	idx := make(map[string]Metadata)
	entries, err := os.ReadDir(dir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
				continue
			}
			if m, title, ok := parse(filepath.Join(dir, e.Name())); ok && title != "" {
				idx[title] = m
			}
		}
	}
	r.dirIndex[dir] = idx
	return idx
}

// parse reads a sidecar file and converts it. It returns the metadata, the
// sidecar's title (original media filename), and whether it parsed as a sidecar.
func parse(path string) (Metadata, string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Metadata{}, "", false
	}
	var sc sidecar
	if err := json.Unmarshal(data, &sc); err != nil {
		return Metadata{}, "", false
	}
	// A Takeout media sidecar always carries a title and a photoTakenTime; use
	// that to avoid treating unrelated JSON (e.g. album metadata) as a sidecar.
	if sc.Title == "" || sc.PhotoTakenTime.Timestamp == "" {
		return Metadata{}, "", false
	}

	m := Metadata{Description: strings.TrimSpace(sc.Description), Favorite: sc.Favorited}
	if secs, err := strconv.ParseInt(sc.PhotoTakenTime.Timestamp, 10, 64); err == nil && secs > 0 {
		t := time.Unix(secs, 0).UTC()
		m.TakenAt = &t
	}
	if lat, lon, ok := pickGeo(sc); ok {
		m.Lat, m.Lon = &lat, &lon
	}
	return m, sc.Title, true
}

// pickGeo prefers geoData, falling back to geoDataExif; (0,0) is treated as
// "no location", which is how Takeout represents unknown coordinates.
func pickGeo(sc sidecar) (float64, float64, bool) {
	if sc.GeoData.Latitude != 0 || sc.GeoData.Longitude != 0 {
		return sc.GeoData.Latitude, sc.GeoData.Longitude, true
	}
	if sc.GeoDataExif.Latitude != 0 || sc.GeoDataExif.Longitude != 0 {
		return sc.GeoDataExif.Latitude, sc.GeoDataExif.Longitude, true
	}
	return 0, 0, false
}
