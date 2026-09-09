package config_test

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/config"
)

// Everything that cannot import Go or read ports.env, held to the numbers in
// ports.go.
//
// The Go server is the source of truth for the whole system — the web and
// mobile clients exist only to talk to it — but a Dockerfile, a Compose file, a
// Caddyfile and a package.json script cannot import a constant. So they carry
// the number literally, and this test is what makes that safe: change ports.go
// and every file below fails until it agrees.
//
// This is the same shape as devproxy_test.go: a value duplicated across
// languages is fine as long as something fails when the copies disagree.
func TestPortsAreConsistentEverywhere(t *testing.T) {
	server := strconv.Itoa(config.DefaultServerPort)
	mobile := strconv.Itoa(config.DevMobilePort)
	e2e := strconv.Itoa(config.E2EPort)

	for _, want := range []struct {
		file string
		text string
		why  string
	}{
		{"Dockerfile", "KURAKI_ADDR=:" + server, "the container must listen on the shipped port"},
		{"Dockerfile", "EXPOSE " + server, "the exposed port must be the one being listened on"},
		{"docker-compose.yml", `"` + server + ":" + server + `"`, "the local Compose publish"},
		{"docker-compose.yml", `KURAKI_ADDR: ":` + server + `"`, "the local Compose listen address"},
		{"deploy/docker-compose.caddy.yml", `KURAKI_ADDR: ":` + server + `"`, "the production listen address"},
		{"deploy/docker-compose.caddy.yml", `- "` + server + `"`, "the port Caddy is allowed to reach"},
		{"deploy/Caddyfile", "reverse_proxy kuraki:" + server, "Caddy's upstream"},
		{"mobile/package.json", "--port " + mobile, "Metro, which must not sit on Expo's contested 8081"},
		{"web/e2e/server.mjs", "?? " + e2e, "the e2e server's fallback port"},
		{"web/playwright.config.ts", "?? " + e2e, "the e2e client's fallback port"},
	} {
		body := readRepoFile(t, want.file)
		if !strings.Contains(body, want.text) {
			t.Errorf("%s does not contain %q (%s) — it disagrees with internal/config/ports.go",
				want.file, want.text, want.why)
		}
	}
}

// ports.env and the mobile constant are generated, so the real risk is not that
// they are wrong but that someone edited them by hand and never ran `make
// ports`. `make check-gen` catches that by regenerating and diffing; this
// catches the case where the generated file is simply missing or stale in a
// checkout that has not run the generator.
func TestGeneratedPortFilesMatch(t *testing.T) {
	env := readRepoFile(t, "ports.env")
	for key, value := range map[string]int{
		"KURAKI_DEFAULT_PORT": config.DefaultServerPort,
		"KURAKI_PORT":         config.DevServerPort,
		"KURAKI_WEB_PORT":     config.DevWebPort,
		"KURAKI_MOBILE_PORT":  config.DevMobilePort,
		"KURAKI_E2E_PORT":     config.E2EPort,
	} {
		line := key + "=" + strconv.Itoa(value)
		if !strings.Contains(env, line) {
			t.Errorf("ports.env is missing %q; run `make ports`", line)
		}
	}

	ts := readRepoFile(t, "mobile/src/design/ports.ts")
	want := "'" + strconv.Itoa(config.DefaultServerPort) + "'"
	if !strings.Contains(ts, want) {
		t.Errorf("mobile/src/design/ports.ts does not carry %s; run `make ports`", want)
	}
}

// The dev ports must differ from the shipped one, or a hot-reload session
// cannot run beside a container already serving the real library — which is the
// whole reason there is more than one number.
func TestDevPortsDoNotCollideWithTheServer(t *testing.T) {
	seen := map[int]string{}
	for name, port := range map[string]int{
		"DefaultServerPort": config.DefaultServerPort,
		"DevServerPort":     config.DevServerPort,
		"DevWebPort":        config.DevWebPort,
		"DevMobilePort":     config.DevMobilePort,
		"E2EPort":           config.E2EPort,
	} {
		if other, clash := seen[port]; clash {
			t.Errorf("%s and %s are both %d; they cannot run at the same time", name, other, port)
		}
		seen[port] = name
		// Below the ephemeral floor macOS allocates from, so the OS cannot hand
		// one of these to an outbound connection and make a bind fail at random.
		if port < 1024 || port >= 49152 {
			t.Errorf("%s = %d is outside the safe user-port range", name, port)
		}
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
