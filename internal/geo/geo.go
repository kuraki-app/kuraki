// Package geo does offline reverse geocoding: it resolves GPS coordinates to a
// nearest city and country using an embedded dataset, so a user's locations
// never leave their own server. The dataset is GeoNames cities15000 (cities with
// population >= 15,000) plus ISO country names.
package geo

import (
	"bufio"
	"bytes"
	_ "embed"
	"math"
	"strconv"
	"strings"
	"sync"
)

//go:embed data/cities.tsv
var citiesData []byte

//go:embed data/countries.tsv
var countriesData []byte

type city struct {
	name string
	cc   string
	lat  float64
	lon  float64
}

// Place is a resolved location.
type Place struct {
	City    string
	Country string
}

var (
	once      sync.Once
	grid      map[[2]int][]city // keyed by 1-degree lat/lon cell
	countries map[string]string
)

func load() {
	countries = make(map[string]string, 256)
	cs := bufio.NewScanner(bytes.NewReader(countriesData))
	for cs.Scan() {
		if p := strings.SplitN(cs.Text(), "\t", 2); len(p) == 2 {
			countries[p[0]] = p[1]
		}
	}

	grid = make(map[[2]int][]city, 16384)
	sc := bufio.NewScanner(bytes.NewReader(citiesData))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		if len(f) != 4 {
			continue
		}
		lat, err1 := strconv.ParseFloat(f[2], 64)
		lon, err2 := strconv.ParseFloat(f[3], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		key := [2]int{int(math.Floor(lat)), int(math.Floor(lon))}
		grid[key] = append(grid[key], city{name: f[0], cc: f[1], lat: lat, lon: lon})
	}
}

// Reverse resolves coordinates to the nearest city and its country. ok is false
// for invalid coordinates or if no city can be found.
func Reverse(lat, lon float64) (Place, bool) {
	once.Do(load)
	if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return Place{}, false
	}

	baseLat := int(math.Floor(lat))
	baseLon := int(math.Floor(lon))
	cosLat := math.Cos(lat * math.Pi / 180)

	var best city
	bestDist := math.MaxFloat64
	foundRing := -1

	// Expand square rings outward from the coordinate's cell until a city is
	// found, then scan one extra ring so a nearer city in an adjacent cell is
	// not missed.
	for r := 0; r <= 10; r++ {
		if foundRing >= 0 && r > foundRing+1 {
			break
		}
		for dLat := -r; dLat <= r; dLat++ {
			for dLon := -r; dLon <= r; dLon++ {
				if r > 0 && dLat > -r && dLat < r && dLon > -r && dLon < r {
					continue // interior already scanned at smaller r
				}
				for _, c := range grid[[2]int{baseLat + dLat, wrapLon(baseLon + dLon)}] {
					dy := c.lat - lat
					dx := (c.lon - lon) * cosLat
					if d := dy*dy + dx*dx; d < bestDist {
						bestDist, best = d, c
						if foundRing < 0 {
							foundRing = r
						}
					}
				}
			}
		}
	}
	if foundRing < 0 {
		return Place{}, false
	}
	return Place{City: best.name, Country: countries[best.cc]}, true
}

func wrapLon(lon int) int {
	switch {
	case lon < -180:
		return lon + 360
	case lon > 179:
		return lon - 360
	default:
		return lon
	}
}
