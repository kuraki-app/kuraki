package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// The pairing screen must not be handed an address that cannot work.
//
// Inside a container the only non-loopback interface is the bridge — an
// address on the container's own port that no phone can route to. The screen
// treats a server-reported address as better than the browser's origin: it
// prefilled the bridge IP and, because the prefilled value was not loopback,
// dropped the "a phone using this would try to reach itself" warning as well.
// The Docker install path is the documented one, so that was the default
// experience: a confident wrong answer in place of a hedged right one.
func TestServerAddressesInContainer(t *testing.T) {
	marker := filepath.Join(t.TempDir(), ".containerenv")
	if err := os.WriteFile(marker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	swapContainerMarkers(t, marker)

	addrs := addressesFrom(t, Deps{ListenPort: "3000"})
	if len(addrs) != 0 {
		t.Errorf("container reported %v; it can only see its own bridge", addrs)
	}
}

// An operator who states the address outranks anything detected — it is the
// only correct answer behind a reverse proxy, where the published scheme, host
// and port all differ from the listener's.
func TestServerAddressesPreferPublicURL(t *testing.T) {
	swapContainerMarkers(t, filepath.Join(t.TempDir(), "absent"))

	addrs := addressesFrom(t, Deps{ListenPort: "3000", PublicURL: "https://photos.example.com"})
	if len(addrs) != 1 || addrs[0] != "https://photos.example.com" {
		t.Errorf("addresses = %v, want the stated public URL alone", addrs)
	}
}

// Outside a container, interface detection is still the right answer and is
// still used.
func TestServerAddressesFallBackToInterfaces(t *testing.T) {
	swapContainerMarkers(t, filepath.Join(t.TempDir(), "absent"))

	// Not asserting a specific address: which interfaces exist depends on the
	// machine. What matters is that detection runs at all rather than being
	// short-circuited, and that anything reported carries the listen port.
	for _, addr := range addressesFrom(t, Deps{ListenPort: "3000"}) {
		if !strings.HasSuffix(addr, ":3000") {
			t.Errorf("address %q does not carry the listen port", addr)
		}
	}
}

func swapContainerMarkers(t *testing.T, markers ...string) {
	t.Helper()
	original := containerMarkers
	containerMarkers = markers
	t.Cleanup(func() { containerMarkers = original })
}

func addressesFrom(t *testing.T, d Deps) []string {
	t.Helper()
	rec := httptest.NewRecorder()
	d.serverAddresses(rec, httptest.NewRequest(http.MethodGet, "/api/server-addresses", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var out apitypes.ServerAddresses
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out.Addresses
}
