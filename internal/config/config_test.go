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
	if c.Addr != ":3000" {
		t.Errorf("Addr = %q", c.Addr)
	}
	if got, want := c.DBPath(), filepath.Join("./kuraki-data", "kuraki.db"); got != want {
		t.Errorf("DBPath = %q, want %q", got, want)
	}
}

func TestLoadEnvOverride(t *testing.T) {
	env := map[string]string{
		"KURAKI_DATA_DIR": "/srv/photos",
		"KURAKI_ADDR":     ":8080",
	}
	c := Load(func(k string) string { return env[k] })
	if c.DataDir != "/srv/photos" {
		t.Errorf("DataDir = %q", c.DataDir)
	}
	if c.Addr != ":8080" {
		t.Errorf("Addr = %q", c.Addr)
	}
	if got, want := c.OriginalsDir(), filepath.Join("/srv/photos", "originals"); got != want {
		t.Errorf("OriginalsDir = %q, want %q", got, want)
	}
}
