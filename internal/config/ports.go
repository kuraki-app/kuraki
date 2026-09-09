package config

import "strconv"

// Ports, declared once.
//
// The Go server is the source of truth for every surface: the web client and
// the mobile client only exist to talk to it, so the numbers live here and are
// generated outward (`make ports` writes ports.env and mobile/src/design/
// ports.ts; ports_test.go holds the files that cannot read a generated value —
// Dockerfile, the Compose files, the Caddyfile, package.json — to these same
// numbers).
//
// Why this block, and why five numbers instead of one:
//
//   - 3000 was the old default and it is the most contested port on a
//     developer's machine. On the machine this was written on, a Next.js dev
//     server owned it, so a Kuraki container published a port it never actually
//     held — for 22 hours, while reporting healthy. Self-hosted photo servers
//     avoid this on purpose (Immich 2283, PhotoPrism 2342); Kuraki should too.
//   - 391xx is in the unassigned user-port range, nowhere near the usual
//     suspects (3000/3001/4000/5000/5173/5432/6379/8000/8080/8081/9000), and
//     below 49152 where macOS starts handing out ephemeral ports.
//   - Each thing that listens gets its own number so they can all run at once.
//     A deployed container, a hot-reload session, a Metro bundler and the e2e
//     suite are four servers; sharing a port between any two of them means
//     choosing which one you are allowed to have running.
const (
	// DefaultServerPort is what `kuraki serve` binds without configuration:
	// the container, the Compose publish, and what a phone assumes for a LAN
	// address typed without one.
	DefaultServerPort = 39170

	// DevServerPort is the API half of `scripts/dev.sh`. Deliberately not
	// DefaultServerPort: hot reload has to coexist with a container already
	// serving the real library.
	DevServerPort = 39175

	// DevWebPort is the Vite dev server — the address to actually open while
	// developing the web UI.
	DevWebPort = 39176

	// DevMobilePort is the Metro bundler. Expo's default is 8081, which
	// collides with any other React Native project on the machine; that
	// collision has already cost this repo a debugging session (a foreign
	// Metro answered, and the app failed with a version-mismatch redbox).
	DevMobilePort = 39177

	// E2EPort is the throwaway server `make e2e` boots. Separate so a browser
	// suite can run while a dev session is up.
	E2EPort = 39178
)

// DefaultAddr is the listen address for DefaultServerPort. A leading colon
// means every interface, which is what a server a phone must reach needs.
func DefaultAddr() string { return ":" + strconv.Itoa(DefaultServerPort) }
