package importer

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/domain"
)

// stubProvider answers for exactly one basename, so a test can prove the
// importer consulted the injected provider rather than the Takeout default.
type stubProvider struct {
	byBase map[string]domain.ExternalMetadata
	calls  int
}

func (s *stubProvider) Lookup(path string) (domain.ExternalMetadata, bool) {
	s.calls++
	m, ok := s.byBase[filepath.Base(path)]
	return m, ok
}

func TestRunAppliesInjectedMetadataProvider(t *testing.T) {
	ctx := context.Background()
	runner, database, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "IMG_0001.jpg"))

	taken := time.Date(2021, 3, 4, 5, 6, 7, 0, time.UTC)
	lat, lon := 48.8584, 2.2945
	provider := &stubProvider{byBase: map[string]domain.ExternalMetadata{
		"IMG_0001.jpg": {
			TakenAt:     &taken,
			Lat:         &lat,
			Lon:         &lon,
			Description: "Eiffel tower",
			Favorite:    true,
			Rating:      4,
			Archived:    true,
			Hidden:      false,
			CameraMake:  "Acme",
			CameraModel: "Cam 1",
		},
	}}

	result, err := runner.Run(ctx, Options{SourceDir: sourceDir, Metadata: provider})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Imported != 1 {
		t.Fatalf("result = %+v, want one import", result)
	}
	if provider.calls == 0 {
		t.Fatal("injected provider was never consulted")
	}

	var (
		gotTaken, description, cameraMake, cameraModel string
		gotLat, gotLon                                 float64
		favorite, rating, archived, hidden             int
	)
	err = database.QueryRowContext(ctx, `
		SELECT taken_at, gps_lat, gps_lon, COALESCE(description,''), favorite, rating,
		       archived, hidden, camera_make, camera_model
		FROM assets`).
		Scan(&gotTaken, &gotLat, &gotLon, &description, &favorite, &rating, &archived,
			&hidden, &cameraMake, &cameraModel)
	if err != nil {
		t.Fatalf("asset row: %v", err)
	}
	if !strings.HasPrefix(gotTaken, "2021-03-04T05:06:07") {
		t.Errorf("taken_at = %q, want the provider's capture time", gotTaken)
	}
	if gotLat != lat || gotLon != lon {
		t.Errorf("gps = %v,%v, want %v,%v", gotLat, gotLon, lat, lon)
	}
	if description != "Eiffel tower" {
		t.Errorf("description = %q", description)
	}
	if favorite != 1 || rating != 4 || archived != 1 || hidden != 0 {
		t.Errorf("favorite=%d rating=%d archived=%d hidden=%d, want 1/4/1/0",
			favorite, rating, archived, hidden)
	}
	if cameraMake != "Acme" || cameraModel != "Cam 1" {
		t.Errorf("camera = %q/%q, want Acme/Cam 1", cameraMake, cameraModel)
	}

	// The asset id must be reported back so a migration can attach relations.
	if len(result.Assets) != 1 || result.Assets[0].AssetID == "" || result.Assets[0].Duplicate {
		t.Fatalf("result.Assets = %+v, want one non-duplicate with an id", result.Assets)
	}
}

// A nil provider must keep resolving Google Takeout sidecars exactly as before
// the seam existed — every existing caller depends on it.
func TestRunWithNilProviderStillReadsTakeoutSidecars(t *testing.T) {
	ctx := context.Background()
	runner, database, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	media := filepath.Join(sourceDir, "IMG_0002.jpg")
	writeJPEG(t, media)

	sidecar := map[string]any{
		"title":          "IMG_0002.jpg",
		"description":    "from takeout",
		"favorited":      true,
		"photoTakenTime": map[string]string{"timestamp": "1609459200"}, // 2021-01-01T00:00:00Z
		"geoData":        map[string]float64{"latitude": 35.6762, "longitude": 139.6503},
	}
	raw, err := json.Marshal(sidecar)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(media+".json", raw, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := runner.Run(ctx, Options{SourceDir: sourceDir}); err != nil {
		t.Fatalf("run: %v", err)
	}

	var takenAt, description string
	var favorite int
	if err := database.QueryRowContext(ctx,
		`SELECT taken_at, COALESCE(description,''), favorite FROM assets`).
		Scan(&takenAt, &description, &favorite); err != nil {
		t.Fatalf("asset row: %v", err)
	}
	if !strings.HasPrefix(takenAt, "2021-01-01T00:00:00") {
		t.Errorf("taken_at = %q, want the sidecar capture time", takenAt)
	}
	if description != "from takeout" || favorite != 1 {
		t.Errorf("description=%q favorite=%d, want sidecar values", description, favorite)
	}
}

// Duplicates must still report the id of the asset they duplicate, otherwise a
// re-run of a migration cannot file existing photos into their albums.
func TestRunReportsAssetIDForDuplicates(t *testing.T) {
	ctx := context.Background()
	runner, _, _ := newTestImporter(t, ctx)
	sourceDir := t.TempDir()
	writeJPEG(t, filepath.Join(sourceDir, "dup.jpg"))

	first, err := runner.Run(ctx, Options{SourceDir: sourceDir})
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if len(first.Assets) != 1 {
		t.Fatalf("first run reported %d assets, want 1", len(first.Assets))
	}
	originalID := first.Assets[0].AssetID

	// Re-present the same bytes from a different path so import_state cannot
	// short-circuit it and the duplicate branch is exercised.
	secondDir := t.TempDir()
	raw, err := os.ReadFile(filepath.Join(sourceDir, "dup.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(secondDir, "copy.jpg"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	second, err := runner.Run(ctx, Options{SourceDir: secondDir})
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if second.Duplicates != 1 {
		t.Fatalf("second run = %+v, want one duplicate", second)
	}
	if len(second.Assets) != 1 || !second.Assets[0].Duplicate {
		t.Fatalf("second.Assets = %+v, want one duplicate entry", second.Assets)
	}
	if second.Assets[0].AssetID != originalID {
		t.Errorf("duplicate mapped to %q, want the original %q", second.Assets[0].AssetID, originalID)
	}
}

func TestClampRating(t *testing.T) {
	for _, tc := range []struct{ in, want int }{
		{-3, 0}, {0, 0}, {3, 3}, {5, 5}, {9, 5},
	} {
		if got := clampRating(tc.in); got != tc.want {
			t.Errorf("clampRating(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
