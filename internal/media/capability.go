package media

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/kuraki-app/kuraki/internal/domain"
)

// Capability describes the durable import and web-viewing contract for a file.
// The extension is only an admission hint; the media probe decides whether a
// browser can render the original without a derived preview.
type Capability struct {
	MediaType    domain.MediaType
	MimeType     string
	WebViewable  bool
	NeedsPreview bool
}

// Classify recognises the formats Kuraki currently promises to preserve. More
// exotic formats are deliberately not admitted until a fixture-backed decoder
// and preview path exist.
func Classify(path string) (Capability, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/jpeg", WebViewable: true}, true
	case ".png":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/png", WebViewable: true}, true
	case ".gif":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/gif", WebViewable: true}, true
	case ".webp":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/webp", WebViewable: true}, true
	case ".avif":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/avif", WebViewable: true}, true
	case ".heic", ".heif":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/heic", NeedsPreview: true}, true
	case ".tif", ".tiff":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/tiff", NeedsPreview: true}, true
	case ".bmp":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/bmp", NeedsPreview: true}, true
	case ".jxl":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/jxl", NeedsPreview: true}, true
	case ".jp2", ".j2k", ".jpf", ".jpx":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/jp2", NeedsPreview: true}, true
	case ".dng", ".cr2", ".cr3", ".nef", ".arw", ".rw2", ".orf", ".raf", ".raw":
		return Capability{MediaType: domain.MediaImage, MimeType: "image/x-raw", NeedsPreview: true}, true
	case ".mp4":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/mp4", NeedsPreview: true}, true
	case ".m4v":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/x-m4v", NeedsPreview: true}, true
	case ".mov":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/quicktime", NeedsPreview: true}, true
	case ".webm":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/webm", NeedsPreview: true}, true
	case ".mkv":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/x-matroska", NeedsPreview: true}, true
	case ".avi":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/x-msvideo", NeedsPreview: true}, true
	case ".3gp", ".3gpp":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/3gpp", NeedsPreview: true}, true
	case ".mts", ".m2ts", ".m2t", ".ts":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/mp2t", NeedsPreview: true}, true
	case ".mpg", ".mpeg", ".mpe":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/mpeg", NeedsPreview: true}, true
	case ".wmv":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/x-ms-wmv", NeedsPreview: true}, true
	default:
		return Capability{}, false
	}
}

// ClassifyFile identifies supported media from its bytes, using the filename
// extension only for opaque camera RAW formats that have no stable common
// signature. This prevents an arbitrary file named .jpg or .mp4 from entering
// the library while allowing correctly encoded media with a lost/wrong suffix.
func ClassifyFile(path string) (Capability, bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return Capability{}, false, fmt.Errorf("media: open %s: %w", path, err)
	}
	defer f.Close()
	head := make([]byte, 4096)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return Capability{}, false, fmt.Errorf("media: read %s: %w", path, err)
	}
	head = head[:n]
	if cap, ok := classifyBytes(head); ok {
		return cap, true, nil
	}
	if cap, ok := Classify(path); ok && cap.MimeType == "image/x-raw" && len(head) > 0 {
		return cap, true, nil
	}
	// net/http detects common non-media text and document signatures, providing
	// a final guard against a misleading supported extension.
	if mime := http.DetectContentType(head); mime != "application/octet-stream" &&
		!strings.HasPrefix(mime, "image/") && !strings.HasPrefix(mime, "video/") {
		return Capability{}, false, nil
	}
	return Capability{}, false, nil
}

func classifyBytes(head []byte) (Capability, bool) {
	imageCap := func(mime string, viewable bool) Capability {
		return Capability{MediaType: domain.MediaImage, MimeType: mime, WebViewable: viewable, NeedsPreview: !viewable}
	}
	videoCap := func(mime string) Capability {
		return Capability{MediaType: domain.MediaVideo, MimeType: mime, NeedsPreview: true}
	}
	switch {
	case len(head) >= 3 && bytes.Equal(head[:3], []byte{0xff, 0xd8, 0xff}):
		return imageCap("image/jpeg", true), true
	case len(head) >= 8 && bytes.Equal(head[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return imageCap("image/png", true), true
	case len(head) >= 6 && (bytes.Equal(head[:6], []byte("GIF87a")) || bytes.Equal(head[:6], []byte("GIF89a"))):
		return imageCap("image/gif", true), true
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return imageCap("image/webp", true), true
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "AVI ":
		return videoCap("video/x-msvideo"), true
	case len(head) >= 2 && (bytes.Equal(head[:2], []byte{'I', 'I'}) || bytes.Equal(head[:2], []byte{'M', 'M'})) &&
		((head[0] == 'I' && head[2] == 0x2a && head[3] == 0) || (head[0] == 'M' && head[2] == 0 && head[3] == 0x2a)):
		return imageCap("image/tiff", false), true
	case len(head) >= 2 && bytes.Equal(head[:2], []byte("BM")):
		return imageCap("image/bmp", false), true
	case len(head) >= 12 && bytes.Equal(head[:12], []byte{0, 0, 0, 0x0c, 'j', 'P', ' ', ' ', '\r', '\n', 0x87, '\n'}):
		return imageCap("image/jp2", false), true
	case len(head) >= 2 && bytes.Equal(head[:2], []byte{0xff, 0x0a}):
		return imageCap("image/jxl", false), true
	case len(head) >= 12 && string(head[4:8]) == "JXL ":
		return imageCap("image/jxl", false), true
	case len(head) >= 4 && bytes.Equal(head[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		if bytes.Contains(bytes.ToLower(head), []byte("webm")) {
			return videoCap("video/webm"), true
		}
		return videoCap("video/x-matroska"), true
	case len(head) >= 16 && bytes.Equal(head[:16], []byte{0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0, 0xaa, 0, 0x62, 0xce, 0x6c}):
		return videoCap("video/x-ms-wmv"), true
	case len(head) >= 4 && bytes.Equal(head[:4], []byte{0, 0, 1, 0xba}):
		return videoCap("video/mpeg"), true
	case len(head) >= 1 && head[0] == 0x47:
		return videoCap("video/mp2t"), true
	case len(head) >= 12 && string(head[4:8]) == "ftyp":
		return classifyISOBaseMedia(string(head[8:12]), imageCap, videoCap)
	default:
		return Capability{}, false
	}
}

func classifyISOBaseMedia(brand string, imageCap func(string, bool) Capability, videoCap func(string) Capability) (Capability, bool) {
	switch brand {
	case "avif", "avis":
		return imageCap("image/avif", true), true
	case "heic", "heix", "hevc", "hevx", "mif1", "msf1":
		return imageCap("image/heic", false), true
	case "qt  ":
		return videoCap("video/quicktime"), true
	case "3gp4", "3gp5", "3gp6":
		return videoCap("video/3gpp"), true
	case "isom", "iso2", "mp41", "mp42", "M4V ", "M4A ":
		return videoCap("video/mp4"), true
	default:
		return Capability{}, false
	}
}

// IsWebImage reports formats that are safe to hand to an img element on the
// supported current browsers. TIFF and HEIC/HEIF intentionally require a
// raster preview instead.
func IsWebImage(mimeType string) bool {
	switch strings.ToLower(mimeType) {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif":
		return true
	default:
		return false
	}
}

// VideoInfo is the subset of ffprobe output used to make a conservative web
// playback decision. Container extensions alone are not reliable indicators.
type VideoInfo struct {
	Width       int
	Height      int
	DurationMS  int64
	VideoCodec  string
	AudioCodec  string
	WebViewable bool
}

type ffprobeOutput struct {
	Streams []struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

// ProbeVideo asks ffprobe for container/codec facts. If ffprobe is absent,
// callers should retain the original but leave it download-only rather than
// guessing that a browser can play it.
func ProbeVideo(ctx context.Context, path, mimeType string) (VideoInfo, error) {
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return VideoInfo{}, ErrUnsupported
	}
	cmd := exec.CommandContext(ctx, ffprobe,
		"-v", "error", "-show_streams", "-show_format", "-of", "json", path)
	out, err := cmd.Output()
	if err != nil {
		return VideoInfo{}, fmt.Errorf("media: ffprobe %s: %w", path, err)
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return VideoInfo{}, fmt.Errorf("media: parse ffprobe output: %w", err)
	}
	info := VideoInfo{}
	for _, stream := range parsed.Streams {
		switch stream.CodecType {
		case "video":
			if info.VideoCodec == "" {
				info.VideoCodec = strings.ToLower(stream.CodecName)
				info.Width, info.Height = stream.Width, stream.Height
			}
		case "audio":
			if info.AudioCodec == "" {
				info.AudioCodec = strings.ToLower(stream.CodecName)
			}
		}
	}
	if seconds, err := strconv.ParseFloat(parsed.Format.Duration, 64); err == nil && seconds > 0 {
		info.DurationMS = int64(seconds * 1000)
	}
	info.WebViewable = browserVideoCompatible(mimeType, info.VideoCodec, info.AudioCodec)
	return info, nil
}

func browserVideoCompatible(mimeType, videoCodec, audioCodec string) bool {
	mimeType = strings.ToLower(mimeType)
	videoCodec = strings.ToLower(videoCodec)
	audioCodec = strings.ToLower(audioCodec)
	switch mimeType {
	case "video/mp4", "video/x-m4v":
		return videoCodec == "h264" && (audioCodec == "" || audioCodec == "aac" || audioCodec == "mp3")
	case "video/webm":
		return (videoCodec == "vp8" || videoCodec == "vp9" || videoCodec == "av1") &&
			(audioCodec == "" || audioCodec == "opus" || audioCodec == "vorbis")
	default:
		return false
	}
}

// TranscodeVideo writes a browser-compatible H.264/AAC MP4 derivative. It is
// deliberately file-to-file so a large video never has to live in memory.
func TranscodeVideo(ctx context.Context, source, destination string) error {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return ErrUnsupported
	}
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", source,
		"-map", "0:v:0", "-map", "0:a?",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
		"-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
		destination,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("media: transcode %s: %s: %w", source, message, err)
	}
	return nil
}
