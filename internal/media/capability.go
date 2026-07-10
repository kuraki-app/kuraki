package media

import (
	"context"
	"encoding/json"
	"fmt"
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
	case ".mp4":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/mp4", NeedsPreview: true}, true
	case ".m4v":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/x-m4v", NeedsPreview: true}, true
	case ".mov":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/quicktime", NeedsPreview: true}, true
	case ".webm":
		return Capability{MediaType: domain.MediaVideo, MimeType: "video/webm", NeedsPreview: true}, true
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
