package media

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"strings"

	// stdlib decoders (register for image.DecodeConfig / image.Decode)
	_ "image/gif"
	_ "image/png"

	"github.com/evanoberholster/imagemeta"
	"github.com/kuraki-app/kuraki/internal/domain"
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

func (p *PureGo) ThumbnailFormat() (format string, extension string) {
	return "jpeg", "jpg"
}

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

	meta := Meta{
		Width:     cfg.Width,
		Height:    cfg.Height,
		MimeType:  "image/" + format,
		MediaType: domain.MediaImage,
	}
	meta.WebViewable = IsWebImage(meta.MimeType)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return meta, nil
	}
	ex, err := imagemeta.Decode(f)
	if err != nil {
		return meta, nil
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
	return meta, nil
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
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return ErrUnsupported
	}
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-ss", "0",
		"-i", videoPath,
		"-frames:v", "1",
		"-f", "image2pipe",
		"-vcodec", "mjpeg",
		"pipe:1",
	)
	cmd.Stdout = dst
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("media: ffmpeg poster %s: %s: %w", videoPath, msg, err)
	}
	return nil
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
