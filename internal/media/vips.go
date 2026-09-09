//go:build vips

package media

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"runtime"
	"strings"
	"sync"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/evanoberholster/imagemeta"
	"github.com/kuraki-app/kuraki/internal/domain"
)

// Vips is the libvips-backed Processor. It handles broader image formats than
// the pure-Go backend and writes WebP thumbnails.
type Vips struct {
	fallback *PureGo
}

// vipsWarned remembers which libvips warnings have already been reported, so a
// decoder quirk shared by every file in a library is stated once rather than
// once per photo.
var vipsWarned sync.Map

// vipsLog routes a libvips/glib message into slog.
//
// govips ships its own handler that writes unstructured `log.Printf` lines to
// stderr at info verbosity — roughly ten per image ("selected loader is ...",
// "converting to processing space srgb"), which buried the result line of an
// import and broke the structured-logging invariant. Errors and criticals are
// always logged; warnings are deduplicated by message, because the common one
// ("heifload: ignoring nclx profile") is emitted for every HEIC an iPhone
// library contains and says nothing new the second time.
func vipsLog(domain string, level vips.LogLevel, message string) {
	switch level {
	case vips.LogLevelError, vips.LogLevelCritical:
		slog.Error("libvips", "domain", domain, "message", message)
	default:
		if _, seen := vipsWarned.LoadOrStore(domain+": "+message, struct{}{}); seen {
			return
		}
		slog.Warn("libvips", "domain", domain, "message", message)
	}
}

// NewVips starts libvips lazily and returns a Processor implementation. If
// startup fails, individual operations will surface that error through govips.
func NewVips() *Vips {
	// Must precede Startup: govips installs its own info-level handler on first
	// start unless the settings have already been overridden, and Startup itself
	// logs through it.
	vips.LoggingSettings(vipsLog, vips.LogLevelWarning)
	_ = vips.Startup(&vips.Config{
		ConcurrencyLevel: min(max(runtime.GOMAXPROCS(0), 1), 2),
		MaxCacheMem:      50 * 1024 * 1024,
		MaxCacheSize:     100,
		MaxCacheFiles:    0,
	})
	return &Vips{fallback: NewPureGo()}
}

func (p *Vips) ThumbnailFormat() (format string, extension string) {
	return "webp", "webp"
}

func (p *Vips) Probe(ctx context.Context, srcPath string) (Meta, error) {
	if err := ctx.Err(); err != nil {
		return Meta{}, err
	}
	img, err := vips.NewImageFromFile(srcPath)
	if err != nil {
		return Meta{}, fmt.Errorf("media: vips probe %s: %w", srcPath, err)
	}
	defer img.Close()

	meta := Meta{
		Width:     img.Width(),
		Height:    img.Height(),
		MimeType:  mimeForVipsType(img.OriginalFormat()),
		MediaType: domain.MediaImage,
	}
	if meta.MimeType == "" {
		meta.MimeType = mimeForVipsType(img.Format())
	}
	meta.WebViewable = IsWebImage(meta.MimeType)
	mergeImageMeta(&meta, srcPath)
	return meta, nil
}

func (p *Vips) Thumbnail(ctx context.Context, srcPath string, maxEdge int, dst io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	img, err := vips.LoadThumbnailFromFile(srcPath, maxEdge, maxEdge, vips.InterestingNone, vips.SizeDown, nil)
	if err != nil {
		return fmt.Errorf("media: vips thumbnail %s: %w", srcPath, err)
	}
	defer img.Close()

	params := vips.NewWebpExportParams()
	params.Quality = 82
	params.StripMetadata = true
	buf, _, err := img.ExportWebp(params)
	if err != nil {
		return fmt.Errorf("media: vips export webp %s: %w", srcPath, err)
	}
	if _, err := dst.Write(buf); err != nil {
		return fmt.Errorf("media: write thumbnail: %w", err)
	}
	return nil
}

func (p *Vips) Poster(ctx context.Context, videoPath string, dst io.Writer) error {
	return p.fallback.Poster(ctx, videoPath, dst)
}

func mergeImageMeta(meta *Meta, srcPath string) {
	f, err := os.Open(srcPath)
	if err != nil {
		return
	}
	defer f.Close()

	ex, err := imagemeta.Decode(f)
	if err != nil {
		return
	}
	if taken := ex.SelectedDate(); !taken.IsZero() {
		t := taken.UTC()
		meta.TakenAt = &t
	}
	meta.CameraMake = strings.TrimSpace(ex.CameraMake())
	meta.CameraModel = strings.TrimSpace(ex.IFD0.Model)
	if lat, lon := ex.GPS.Latitude(), ex.GPS.Longitude(); lat != 0 || lon != 0 {
		meta.GPSLat = &lat
		meta.GPSLon = &lon
	}
}

func mimeForVipsType(t vips.ImageType) string {
	switch t {
	case vips.ImageTypeGIF:
		return "image/gif"
	case vips.ImageTypeJPEG:
		return "image/jpeg"
	case vips.ImageTypePNG:
		return "image/png"
	case vips.ImageTypeSVG:
		return "image/svg+xml"
	case vips.ImageTypeTIFF:
		return "image/tiff"
	case vips.ImageTypeWEBP:
		return "image/webp"
	case vips.ImageTypeHEIF:
		return "image/heic"
	case vips.ImageTypeBMP:
		return "image/bmp"
	case vips.ImageTypeAVIF:
		return "image/avif"
	case vips.ImageTypeJP2K:
		return "image/jp2"
	case vips.ImageTypeJXL:
		return "image/jxl"
	default:
		return ""
	}
}

var _ Processor = (*Vips)(nil)
