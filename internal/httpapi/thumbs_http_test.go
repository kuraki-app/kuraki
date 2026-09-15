package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/thumbs"
)

func getWithCookie(router http.Handler, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestThumbnailURLsAreVersionedAndImmutable(t *testing.T) {
	ctx := context.Background()
	database, store, _ := seedHTTPAsset(t, ctx)
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Media: media.NewPureGo(), Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	asset := getJSONWithCookie[apitypes.AssetList](t, router, "/api/assets", cookie).Assets[0]
	want := thumbs.Version(asset.ID, 0, "jpeg")
	if asset.ThumbnailURL == nil || *asset.ThumbnailURL != "/api/assets/"+asset.ID+"/thumb?v="+want {
		t.Fatalf("thumbnail_url = %v, want versioned medium URL", asset.ThumbnailURL)
	}
	if asset.ThumbnailURLs == nil ||
		asset.ThumbnailURLs.S != "/api/assets/"+asset.ID+"/thumb?size=s&v="+want ||
		asset.ThumbnailURLs.M != *asset.ThumbnailURL ||
		asset.ThumbnailURLs.L != "/api/assets/"+asset.ID+"/thumb?size=l&v="+want {
		t.Fatalf("thumbnail_urls = %+v", asset.ThumbnailURLs)
	}

	for _, path := range []string{asset.ThumbnailURLs.S, asset.ThumbnailURLs.M, asset.ThumbnailURLs.L} {
		rec := getWithCookie(router, path, cookie)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
			t.Fatalf("GET %s = %d %q", path, rec.Code, rec.Header().Get("Content-Type"))
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "private, max-age=31536000, immutable" {
			t.Fatalf("GET %s Cache-Control = %q", path, cc)
		}
	}
	for _, path := range []string{"/api/assets/" + asset.ID + "/thumb", "/api/assets/" + asset.ID + "/thumb?v=stale"} {
		rec := getWithCookie(router, path, cookie)
		if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("GET %s = %d %q, want 200 private, no-cache", path, rec.Code, rec.Header().Get("Cache-Control"))
		}
	}
	if rec := getWithCookie(router, "/api/assets/"+asset.ID+"/thumb?size=xl", cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid size = %d, want 400", rec.Code)
	}
}

func TestWriteThumbError(t *testing.T) {
	d := Deps{Logger: slog.Default()}
	cases := []struct {
		err    error
		code   int
		retry  string
		reason string
	}{
		{thumbs.ErrNotFound, http.StatusNotFound, "", "asset_not_found"},
		{thumbs.ErrNoSource, http.StatusNotFound, "", "thumb_not_found"},
		{thumbs.ErrBusy, http.StatusServiceUnavailable, "2", "thumb_busy"},
		{context.Canceled, http.StatusServiceUnavailable, "2", "thumb_busy"},
		{context.DeadlineExceeded, http.StatusServiceUnavailable, "2", "thumb_busy"},
		{errors.New("boom"), http.StatusInternalServerError, "", "thumb_failed"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		if d.writeThumbError(rec, c.err, "thumb_not_found") {
			t.Fatalf("%v reported success", c.err)
		}
		if rec.Code != c.code || rec.Header().Get("Retry-After") != c.retry || !strings.Contains(rec.Body.String(), c.reason) {
			t.Fatalf("%v = %d retry=%q body=%s", c.err, rec.Code, rec.Header().Get("Retry-After"), rec.Body.String())
		}
	}
	if !d.writeThumbError(httptest.NewRecorder(), nil, "thumb_not_found") {
		t.Fatal("nil error reported failure")
	}
}
