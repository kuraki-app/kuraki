package thumbs

import (
	"errors"
	"regexp"
	"testing"
)

func TestParseTier(t *testing.T) {
	for raw, want := range map[string]Tier{"": TierMedium, "m": TierMedium, "s": TierSmall, "l": TierLarge} {
		got, err := ParseTier(raw)
		if err != nil || got != want {
			t.Fatalf("ParseTier(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	if _, err := ParseTier("xl"); !errors.Is(err, ErrBadTier) {
		t.Fatalf("ParseTier(xl) err = %v, want ErrBadTier", err)
	}
}

func TestEdgeForSkipsRedundantTiers(t *testing.T) {
	cases := []struct {
		tier   Tier
		medium int
		want   int
	}{
		{TierSmall, 512, 256}, {TierLarge, 512, 1200}, {TierMedium, 512, 0},
		{TierSmall, 256, 0}, {TierSmall, 200, 0}, {TierLarge, 1200, 0}, {TierLarge, 2048, 0},
	}
	for _, c := range cases {
		if got := edgeFor(c.tier, c.medium); got != c.want {
			t.Fatalf("edgeFor(%s, %d) = %d, want %d", c.tier, c.medium, got, c.want)
		}
	}
}

func TestPathForAndVersion(t *testing.T) {
	if got := PathFor("a1", "thumb_1200", 3, "webp"); got != "derivatives/a1/thumb_1200_g3.webp" {
		t.Fatalf("PathFor = %q", got)
	}
	v := Version("a1", 0, "jpeg")
	if !regexp.MustCompile(`^[0-9a-f]{10}$`).MatchString(v) {
		t.Fatalf("Version = %q, want 10 hex chars", v)
	}
	if v != Version("a1", 0, "jpeg") {
		t.Fatal("Version is not deterministic")
	}
	if v == Version("a1", 1, "jpeg") || v == Version("a1", 0, "webp") {
		t.Fatal("Version ignores gen or format")
	}
}

func TestFitWithin(t *testing.T) {
	if w, h := FitWithin(4000, 3000, 1200); w != 1200 || h != 900 {
		t.Fatalf("landscape = %dx%d", w, h)
	}
	if w, h := FitWithin(3000, 4000, 1200); w != 900 || h != 1200 {
		t.Fatalf("portrait = %dx%d", w, h)
	}
	if w, h := FitWithin(64, 48, 1200); w != 64 || h != 48 {
		t.Fatalf("no upscale = %dx%d", w, h)
	}
	if w, h := FitWithin(0, 0, 1200); w != 0 || h != 0 {
		t.Fatalf("unknown dims = %dx%d", w, h)
	}
}
