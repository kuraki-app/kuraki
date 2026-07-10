package geo

import "testing"

func TestReverse(t *testing.T) {
	cases := []struct {
		name         string
		lat, lon     float64
		wantCountry  string
		wantCityHint string // substring the resolved city should contain
	}{
		{"paris", 48.8566, 2.3522, "France", "Paris"},
		{"tokyo", 35.6895, 139.6917, "Japan", "Tokyo"},
		{"nyc", 40.7128, -74.0060, "United States", "York"},
		{"london", 51.5074, -0.1278, "United Kingdom", "London"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, ok := Reverse(c.lat, c.lon)
			if !ok {
				t.Fatalf("Reverse(%v,%v) not found", c.lat, c.lon)
			}
			if p.Country != c.wantCountry {
				t.Errorf("country = %q, want %q", p.Country, c.wantCountry)
			}
			if p.City == "" {
				t.Errorf("city empty for %s", c.name)
			}
		})
	}
}

func TestReverseInvalid(t *testing.T) {
	if _, ok := Reverse(200, 200); ok {
		t.Error("expected invalid coordinates to fail")
	}
}
