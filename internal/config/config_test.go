package config

import (
	"path/filepath"
	"testing"
)

func TestDefault(t *testing.T) {
	c := Default()
	if c.DataDir != "./kuraki-data" {
		t.Errorf("DataDir = %q", c.DataDir)
	}
	// The literal is deliberate: this is the one place that asserts what the
	// shipped default *is*, so moving it has to be a deliberate edit here as
	// well as in ports.go. ports_test.go checks everything downstream follows.
	if c.Addr != ":39170" {
		t.Errorf("Addr = %q", c.Addr)
	}
	if got, want := c.DBPath(), filepath.Join("./kuraki-data", "kuraki.db"); got != want {
		t.Errorf("DBPath = %q, want %q", got, want)
	}
}

func TestLoadEnvOverride(t *testing.T) {
	env := map[string]string{
		"KURAKI_DATA_DIR":             "/srv/photos",
		"KURAKI_ADDR":                 ":8080",
		"KURAKI_TRASH_RETENTION_DAYS": "7",
		"KURAKI_THUMBNAIL_SIZE":       "1024",
		"KURAKI_OCR":                  "true",
	}
	c := Load(func(k string) string { return env[k] })
	if !c.OCREnabled {
		t.Error("OCREnabled = false, want true for KURAKI_OCR=true")
	}
	if Default().OCREnabled {
		t.Error("OCR should be off by default")
	}
	if c.DataDir != "/srv/photos" {
		t.Errorf("DataDir = %q", c.DataDir)
	}
	if c.Addr != ":8080" {
		t.Errorf("Addr = %q", c.Addr)
	}
	if c.TrashRetentionDays != 7 {
		t.Errorf("TrashRetentionDays = %d, want 7", c.TrashRetentionDays)
	}
	if c.ThumbnailSize != 1024 {
		t.Errorf("ThumbnailSize = %d, want 1024", c.ThumbnailSize)
	}
	// Invalid values keep defaults.
	bad := Load(func(k string) string {
		if k == "KURAKI_TRASH_RETENTION_DAYS" {
			return "-3"
		}
		return ""
	})
	if bad.TrashRetentionDays != 30 {
		t.Errorf("invalid retention = %d, want default 30", bad.TrashRetentionDays)
	}
	if got, want := c.OriginalsDir(), filepath.Join("/srv/photos", "originals"); got != want {
		t.Errorf("OriginalsDir = %q, want %q", got, want)
	}
}

func TestLoadHardeningDefaults(t *testing.T) {
	d := Default()
	if d.TrustProxy {
		t.Error("TrustProxy should be off by default so client IPs cannot be spoofed")
	}
	if d.SecureCookies {
		t.Error("SecureCookies should be off by default (opt-in behind TLS)")
	}
	if d.MetricsToken != "" {
		t.Errorf("MetricsToken default = %q, want empty", d.MetricsToken)
	}

	env := map[string]string{
		"KURAKI_TRUST_PROXY":   "1",
		"KURAKI_METRICS_TOKEN": "  scrape-me  ",
	}
	c := Load(func(k string) string { return env[k] })
	if !c.TrustProxy {
		t.Error("TrustProxy = false, want true for KURAKI_TRUST_PROXY=1")
	}
	if c.MetricsToken != "scrape-me" {
		t.Errorf("MetricsToken = %q, want trimmed \"scrape-me\"", c.MetricsToken)
	}
}

// KURAKI_PUBLIC_URL is what an operator states when address detection cannot be
// right — in a container, whose interfaces are its own, or behind a reverse
// proxy, whose published scheme, host and port all differ from the listener's.
func TestLoadPublicURL(t *testing.T) {
	if Default().PublicURL != "" {
		t.Error("PublicURL should be empty by default: detection is right for a bare-metal install")
	}
	// The trailing slash goes: the value is joined with paths downstream, and
	// "https://host//api" is a different URL to some proxies.
	c := Load(func(k string) string {
		if k == "KURAKI_PUBLIC_URL" {
			return "  https://photos.example.com/  "
		}
		return ""
	})
	if c.PublicURL != "https://photos.example.com" {
		t.Errorf("PublicURL = %q, want https://photos.example.com", c.PublicURL)
	}
}
