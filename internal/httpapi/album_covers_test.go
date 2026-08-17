package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// The album list is what draws the cover mosaic, and it used to send no asset
// ids at all -- apitypes.Album had no cover field, so every album in the mobile
// list rendered a blank square. These pin the shape the clients now rely on.
func TestAlbumListCarriesCoverAssets(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, paginationSeedCount)
	albumID := createTestAlbum(t, f) // holds every asset in the library

	list := getJSONWithCookie[apitypes.AlbumList](t, f.router, "/api/albums", f.cookie)
	var found *apitypes.Album
	for i := range list.Albums {
		if list.Albums[i].ID == albumID {
			found = &list.Albums[i]
		}
	}
	if found == nil {
		t.Fatalf("album %s missing from list", albumID)
	}

	// Capped at the mosaic size rather than returning the whole album.
	if len(found.CoverAssetIDs) != coverAssetsPerAlbum {
		t.Errorf("cover ids = %d, want %d", len(found.CoverAssetIDs), coverAssetsPerAlbum)
	}
	// Distinct: a mosaic repeating one photo four times is not a mosaic.
	seen := map[string]bool{}
	for _, id := range found.CoverAssetIDs {
		if seen[id] {
			t.Errorf("duplicate cover id %s", id)
		}
		seen[id] = true
	}
}

// An empty album must send an empty list, not null: the clients iterate it
// without a nil guard, and `validate:"required"` promises it is always there.
func TestEmptyAlbumSendsEmptyCoverList(t *testing.T) {
	ctx := context.Background()
	f := seedPaginationLibrary(t, ctx, 1)

	rec := postJSON(t, f.router, "/api/albums", map[string]string{"name": "Empty"}, f.cookie)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("create album = %d", rec.Code)
	}

	body := getRawWithCookie(t, f.router, "/api/albums", f.cookie).Body.Bytes()
	if !jsonHasEmptyCoverList(t, body) {
		t.Errorf("empty album did not send [] for cover_asset_ids: %s", body)
	}
}

func jsonHasEmptyCoverList(t *testing.T, body []byte) bool {
	t.Helper()
	var parsed struct {
		Albums []struct {
			Name          string           `json:"name"`
			CoverAssetIDs *json.RawMessage `json:"cover_asset_ids"`
		} `json:"albums"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	for _, a := range parsed.Albums {
		if a.Name != "Empty" {
			continue
		}
		return a.CoverAssetIDs != nil && string(*a.CoverAssetIDs) == "[]"
	}
	t.Fatal("album 'Empty' not found in list")
	return false
}
