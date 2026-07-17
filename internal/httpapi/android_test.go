package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadAndroidServesAPK(t *testing.T) {
	apk := filepath.Join(t.TempDir(), "kuraki-android.apk")
	body := []byte("PK\x03\x04 pretend apk bytes")
	if err := os.WriteFile(apk, body, 0o600); err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", AndroidAPKPath: apk})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/download/android", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/vnd.android.package-archive" {
		t.Fatalf("content-type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="kuraki-android.apk"` {
		t.Fatalf("content-disposition = %q", cd)
	}
	if got := rec.Body.Bytes(); string(got) != string(body) {
		t.Fatalf("body = %q, want the apk bytes", got)
	}
}

func TestDownloadAndroidMissingFileIs404(t *testing.T) {
	// Configured path but no file present yet — the common initial state.
	router := NewRouter(Deps{Version: "test", AndroidAPKPath: filepath.Join(t.TempDir(), "absent.apk")})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/download/android", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDownloadAndroidUnconfiguredIs404(t *testing.T) {
	router := NewRouter(Deps{Version: "test"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/download/android", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
