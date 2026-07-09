// Package media processes images and videos behind a Processor interface.
//
// Two backends are planned:
//   - vips (default in production, build tag "vips"): libvips via govips —
//     fastest, lowest-RAM, native HEIC/AVIF/RAW-preview, WebP output.
//   - purego (this file, always available): stdlib + golang.org/x/image, no
//     CGO, JPEG output. The graceful-degradation fallback used when libvips
//     is absent (e.g. plain `go build` without the vips tag).
//
// Keeping both behind one interface is what lets Kuraki promise best-quality
// media on Docker while still building as a portable binary anywhere.
package media

import (
	"context"
	"io"
	"time"

	"github.com/saranshh/kuraki/internal/domain"
)

// Meta is the metadata extracted from a source file during a Probe.
type Meta struct {
	Width       int
	Height      int
	MimeType    string
	MediaType   domain.MediaType
	TakenAt     *time.Time
	CameraMake  string
	CameraModel string
	GPSLat      *float64
	GPSLon      *float64
	DurationMS  int64
}

// Processor inspects and derives representations of media files. Source files
// are read-only; a Processor never mutates an original (F-03).
type Processor interface {
	// Probe reads dimensions, MIME/media type, and EXIF-derived metadata.
	Probe(ctx context.Context, srcPath string) (Meta, error)

	// Thumbnail writes a resized derivative (longest edge <= maxEdge) to dst.
	// The concrete encoding (WebP for vips, JPEG for purego) is backend-defined.
	Thumbnail(ctx context.Context, srcPath string, maxEdge int, dst io.Writer) error

	// Poster writes a video poster frame to dst. Requires ffmpeg; returns
	// ErrUnsupported if unavailable.
	Poster(ctx context.Context, videoPath string, dst io.Writer) error
}
