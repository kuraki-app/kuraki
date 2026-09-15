// Package thumbs owns derivative naming, URL versions, and on-demand generation
// of extra thumbnail tiers. The medium tier is created at import; small and
// large are rendered the first time a client asks, at most once per generation.
package thumbs

import (
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/zeebo/blake3"
)

// Tier names a thumbnail size in URLs, so changing the configured medium size
// never breaks a link.
type Tier string

const (
	TierSmall  Tier = "s"
	TierMedium Tier = "m"
	TierLarge  Tier = "l"

	EdgeSmall = 256
	EdgeLarge = 1200
)

var (
	ErrNotFound = errors.New("thumbs: asset not found")
	ErrBadTier  = errors.New("thumbs: unsupported size")
	ErrBusy     = errors.New("thumbs: generation queue full")
	ErrNoSource = errors.New("thumbs: no renderable source")
)

// Variant is one servable derivative file.
type Variant struct {
	Rel         string // storage-relative, "derivatives/..."
	ContentType string
	Format      string
	Version     string
	Width       int
	Height      int
}

// ParseTier maps a ?size= value to a tier. Empty means medium.
func ParseTier(raw string) (Tier, error) {
	switch Tier(raw) {
	case "", TierMedium:
		return TierMedium, nil
	case TierSmall, TierLarge:
		return Tier(raw), nil
	}
	return "", ErrBadTier
}

// edgeFor returns the variant edge for tier, or 0 when the medium derivative
// already serves it: never upscale, never store a file that adds nothing.
func edgeFor(tier Tier, medium int) int {
	switch tier {
	case TierSmall:
		if medium > EdgeSmall {
			return EdgeSmall
		}
	case TierLarge:
		if medium < EdgeLarge {
			return EdgeLarge
		}
	}
	return 0
}

// PathFor names a derivative file. The generation suffix makes every rebuild
// write a new path, so storage never has to overwrite a file.
func PathFor(assetID, name string, gen int, ext string) string {
	return fmt.Sprintf("derivatives/%s/%s_g%d.%s", assetID, name, gen, ext)
}

// Version is the cache-busting token carried as ?v= on media URLs.
func Version(assetID string, gen int, format string) string {
	sum := blake3.Sum256([]byte(fmt.Sprintf("%s:%d:%s", assetID, gen, format)))
	return hex.EncodeToString(sum[:5])
}

// ContentType maps a stored derivative format to its MIME type.
func ContentType(format string) string {
	switch format {
	case "webp":
		return "image/webp"
	case "mp4":
		return "video/mp4"
	default:
		return "image/jpeg"
	}
}

// Format reports the encoding a processor writes for thumbnails.
func Format(p media.Processor) (format, ext string) {
	if formatter, ok := p.(media.ThumbnailFormatter); ok {
		format, ext = formatter.ThumbnailFormat()
		if format != "" && ext != "" {
			return format, ext
		}
	}
	return "jpeg", "jpg"
}

// FitWithin scales w×h so the longest edge is at most maxEdge, never upscaling.
func FitWithin(w, h, maxEdge int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	if w <= maxEdge && h <= maxEdge {
		return w, h
	}
	if w >= h {
		return maxEdge, max(1, h*maxEdge/w)
	}
	return max(1, w*maxEdge/h), maxEdge
}
