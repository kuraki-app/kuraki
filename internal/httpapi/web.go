package httpapi

import (
	"embed"
	"io/fs"
)

// assetsFS embeds the built web UI. In M0 this is a placeholder page; M1
// replaces internal/httpapi/assets with the SvelteKit static build so the
// entire UI ships inside the single binary (F-01).
//
//go:embed all:assets
var assetsFS embed.FS

// uiFS returns the embedded UI rooted so that "index.html" is at the top.
func uiFS() fs.FS {
	sub, err := fs.Sub(assetsFS, "assets")
	if err != nil {
		panic(err) // embed path is a compile-time constant; cannot fail at runtime
	}
	return sub
}
