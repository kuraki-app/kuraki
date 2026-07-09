//go:build vips

package media

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/evanoberholster/imagemeta"
	"github.com/kuraki-app/kuraki/internal/domain"
)

// Vips is the libvips-backed Processor. It handles broader image formats than
// the pure-Go backend and writes WebP thumbnails.
type Vips struct {
	fallback *PureGo
}

// NewVips starts libvips lazily and returns a Processor implementation. If
// startup fails, individual operations will surface that error through govips.
func NewVips() *Vips {
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
