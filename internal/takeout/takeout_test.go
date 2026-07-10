package takeout

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLookup(t *testing.T) {
	dir := t.TempDir()
	// media files (contents irrelevant to the resolver)
	write(t, filepath.Join(dir, "photo.jpg"), "x")
	write(t, filepath.Join(dir, "trunc.jpg"), "x")

	// exact ".json" sidecar
	write(t, filepath.Join(dir, "photo.jpg.json"), `{
      "title": "photo.jpg",
      "description": "Sunset at the beach",
      "photoTakenTime": { "timestamp": "1609459200" },
      "geoData": { "latitude": 48.8566, "longitude": 2.3522 },
      "favorited": true
    }`)

	// truncated supplemental-metadata sidecar whose name does NOT match the
	// media file, but whose title does.
	write(t, filepath.Join(dir, "trunc.jpg.supplemental-me.json"), `{
      "title": "trunc.jpg",
      "photoTakenTime": { "timestamp": "1262304000" },
      "geoDataExif": { "latitude": 35.68, "longitude": 139.69 }
    }`)

	r := NewResolver()

	m, ok := r.Lookup(filepath.Join(dir, "photo.jpg"))
	if !ok {
		t.Fatal("expected sidecar for photo.jpg")
	}
	if m.Description != "Sunset at the beach" || !m.Favorite {
		t.Errorf("description/favorite wrong: %+v", m)
	}
	if m.TakenAt == nil || m.TakenAt.Year() != 2021 {
		t.Errorf("takenAt = %v, want 2021", m.TakenAt)
	}
	if m.Lat == nil || *m.Lat != 48.8566 {
		t.Errorf("lat = %v", m.Lat)
	}

	// truncated sidecar resolved via the title index
	m2, ok := r.Lookup(filepath.Join(dir, "trunc.jpg"))
	if !ok {
		t.Fatal("expected sidecar for trunc.jpg via title index")
	}
	if m2.Lat == nil || *m2.Lat != 35.68 {
		t.Errorf("exif geo not used: %+v", m2)
	}

	// no sidecar
	if _, ok := r.Lookup(filepath.Join(dir, "missing.jpg")); ok {
		t.Error("did not expect a sidecar for missing.jpg")
	}
}
