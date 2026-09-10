package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/storage"
)

func TestStoredMediaRevalidationAndRange(t *testing.T) {
	store, err := storage.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(context.Background(), "derivatives/clip.mp4", strings.NewReader("0123456789")); err != nil {
		t.Fatal(err)
	}
	serve := func(method string, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/assets/test/preview", nil)
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		w := httptest.NewRecorder()
		serveStored(w, r, Deps{Store: store}, "derivatives/clip.mp4", "video/mp4", "clip.mp4", "private, max-age=604800")
		return w
	}
	first := serve(http.MethodGet, nil)
	if first.Code != http.StatusOK || first.Body.String() != "0123456789" {
		t.Fatalf("initial response: %d %q", first.Code, first.Body.String())
	}
	etag := first.Header().Get("ETag")
	if etag == "" || first.Header().Get("Last-Modified") == "" {
		t.Fatal("missing cache validators")
	}
	if vary := first.Header().Get("Vary"); !strings.Contains(vary, "Cookie") || !strings.Contains(vary, "Authorization") {
		t.Fatalf("credential variance = %q", vary)
	}
	cached := serve(http.MethodGet, map[string]string{"If-None-Match": etag})
	if cached.Code != http.StatusNotModified || cached.Body.Len() != 0 {
		t.Fatalf("revalidation = %d (%d bytes)", cached.Code, cached.Body.Len())
	}
	partial := serve(http.MethodGet, map[string]string{"Range": "bytes=3-6"})
	if partial.Code != http.StatusPartialContent || partial.Body.String() != "3456" {
		t.Fatalf("range = %d %q", partial.Code, partial.Body.String())
	}
	head := serve(http.MethodHead, nil)
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "10" {
		t.Fatalf("HEAD = %d %v", head.Code, head.Header())
	}
	unsatisfied := serve(http.MethodGet, map[string]string{"Range": "bytes=20-30"})
	if unsatisfied.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("invalid range = %d", unsatisfied.Code)
	}
}
