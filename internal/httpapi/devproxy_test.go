package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// devProxyPaths are the top-level paths the Go server owns — everything outside
// /api that is not the SPA itself.
//
// In production these never need listing: the binary embeds the UI and serves
// both from one origin. `make dev` is the single mode where the UI (Vite, :5173)
// and the server (:3000) are different origins, and there each of these has to
// be named in web/vite.config.ts or it resolves against Vite instead.
var devProxyPaths = []string{"/healthz", "/metrics", "/download"}

// The proxy list drifted from the router once already: /download/android was
// added for the Android APK and never added to the proxy, so the Devices page's
// download link 404'd — but only under `make dev`, which is the one mode nobody
// runs the e2e suite against. Nothing connected the two files, so nothing
// noticed.
func TestDevProxyCoversEveryServerOwnedPath(t *testing.T) {
	config := readRepoFile(t, "web/vite.config.ts")
	router := readRepoFile(t, "internal/httpapi/router.go")

	for _, path := range devProxyPaths {
		if !strings.Contains(config, `'`+path+`'`) {
			t.Errorf("web/vite.config.ts does not proxy %q, so it resolves against Vite in `make dev`", path)
		}
		// And the other direction: a path that left the router should leave the
		// list, rather than sitting here implying coverage of nothing.
		if !strings.Contains(router, `"`+path) {
			t.Errorf("router.go registers nothing under %q — drop it from devProxyPaths", path)
		}
	}
}

// The port is chosen once, by scripts/dev.sh, and exported. Hardcoding it in
// vite.config.ts as well meant `--addr :4000` moved the server and left the
// proxy pointing at whatever else held 3000 — not an error, just another app's
// responses arriving in the Kuraki UI.
func TestDevProxyPortFollowsTheServer(t *testing.T) {
	config := readRepoFile(t, "web/vite.config.ts")
	if !strings.Contains(config, "KURAKI_PORT") {
		t.Error("web/vite.config.ts does not read KURAKI_PORT; the proxy can drift from scripts/dev.sh")
	}
	dev := readRepoFile(t, "scripts/dev.sh")
	if !strings.Contains(dev, "export KURAKI_PORT") {
		t.Error("scripts/dev.sh does not export KURAKI_PORT, so vite.config.ts cannot see it")
	}
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "..", rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(body)
}
