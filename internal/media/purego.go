package media

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"

	// stdlib decoders (register for image.DecodeConfig / image.Decode)
	_ "image/gif"
	_ "image/png"

	"github.com/saranshh/kuraki/internal/domain"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // decode-only WebP support
)

// ErrUnsupported indicates the pure-Go backend cannot handle an operation
// (e.g. video posters, which need ffmpeg, or HEIC, which needs libvips).
var ErrUnsupported = errors.New("media: unsupported by pure-Go backend")

// PureGo is the CGO-free fallback Processor. It handles common web-decodable
// images and emits JPEG thumbnails. HEIC/RAW/video require the vips backend
// and/or ffmpeg and return ErrUnsupported here.
type PureGo struct {
	// JPEGQuality for generated thumbnails (1-100).
	JPEGQuality int
}

// NewPureGo returns a PureGo processor with sensible defaults.
func NewPureGo() *PureGo { return &PureGo{JPEGQuality: 82} }

func (p *PureGo) Probe(ctx context.Context, srcPath string) (Meta, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return Meta{}, err
	}
	defer f.Close()

	cfg, format, err := image.DecodeConfig(f)
	if err != nil {
		return Meta{}, fmt.Errorf("media: probe %s: %w", srcPath, err)
	}
	// NOTE: EXIF (TakenAt/camera/GPS) extraction is added in M1 via
	// evanoberholster/imagemeta; probe here reports dimensions + type only.
	return Meta{
		Width:     cfg.Width,
		Height:    cfg.Height,
		MimeType:  "image/" + format,
		MediaType: domain.MediaImage,
	}, nil
}

func (p *PureGo) Thumbnail(ctx context.Context, srcPath string, maxEdge int, dst io.Writer) error {
	f, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		return fmt.Errorf("media: decode %s: %w", srcPath, err)
	}

	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	tw, th := scaleToFit(w, h, maxEdge)
	dstImg := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.CatmullRom.Scale(dstImg, dstImg.Bounds(), src, b, draw.Over, nil)

	return jpeg.Encode(dst, dstImg, &jpeg.Options{Quality: p.JPEGQuality})
}

func (p *PureGo) Poster(ctx context.Context, videoPath string, dst io.Writer) error {
	// Video posters require ffmpeg; wired in M1 (F-13).
	return ErrUnsupported
}

// scaleToFit computes target dimensions so the longest edge equals maxEdge,
// never upscaling beyond the source.
func scaleToFit(w, h, maxEdge int) (int, int) {
	if w <= maxEdge && h <= maxEdge {
		return w, h
	}
	if w >= h {
		return maxEdge, max(1, h*maxEdge/w)
	}
	return max(1, w*maxEdge/h), maxEdge
}

// compile-time check
var _ Processor = (*PureGo)(nil)
