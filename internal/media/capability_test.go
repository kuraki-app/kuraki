package media

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kuraki-app/kuraki/internal/domain"
)

func TestClassifyMediaContract(t *testing.T) {
	tests := []struct {
		name, ext string
		mediaType domain.MediaType
		mimeType  string
		viewable  bool
		accepted  bool
	}{
		{name: "jpeg", ext: "jpeg", mediaType: domain.MediaImage, mimeType: "image/jpeg", viewable: true, accepted: true},
		{name: "heic", ext: "heic", mediaType: domain.MediaImage, mimeType: "image/heic", accepted: true},
		{name: "tiff", ext: "tiff", mediaType: domain.MediaImage, mimeType: "image/tiff", accepted: true},
		{name: "mp4", ext: "mp4", mediaType: domain.MediaVideo, mimeType: "video/mp4", accepted: true},
		{name: "quicktime", ext: "mov", mediaType: domain.MediaVideo, mimeType: "video/quicktime", accepted: true},
		{name: "raw", ext: "raw", mediaType: domain.MediaImage, mimeType: "image/x-raw", accepted: true},
		{name: "camera raw", ext: "arw", mediaType: domain.MediaImage, mimeType: "image/x-raw", accepted: true},
		{name: "jxl", ext: "jxl", mediaType: domain.MediaImage, mimeType: "image/jxl", accepted: true},
		{name: "mkv", ext: "mkv", mediaType: domain.MediaVideo, mimeType: "video/x-matroska", accepted: true},
		{name: "avi", ext: "avi", mediaType: domain.MediaVideo, mimeType: "video/x-msvideo", accepted: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cap, ok := Classify(filepath.Join("library", "fixture."+tt.ext))
			if ok != tt.accepted {
				t.Fatalf("accepted = %v, want %v", ok, tt.accepted)
			}
			if !ok {
				return
			}
			if cap.MediaType != tt.mediaType || cap.MimeType != tt.mimeType || cap.WebViewable != tt.viewable {
				t.Fatalf("capability = %+v", cap)
			}
		})
	}
}

func TestClassifyFileUsesContentBeforeExtension(t *testing.T) {
	dir := t.TempDir()
	tests := []struct {
		name string
		data []byte
		want Capability
		ok   bool
	}{
		{name: "renamed jpeg", data: []byte{0xff, 0xd8, 0xff, 0xdb, 0, 0, 0}, want: Capability{MediaType: domain.MediaImage, MimeType: "image/jpeg", WebViewable: true}, ok: true},
		{name: "disguised text", data: []byte("not an image"), ok: false},
		{name: "heic signature", data: append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p'}, []byte("heic")...), want: Capability{MediaType: domain.MediaImage, MimeType: "image/heic", NeedsPreview: true}, ok: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, tt.name+".jpg")
			if err := os.WriteFile(path, tt.data, 0o600); err != nil {
				t.Fatal(err)
			}
			got, ok, err := ClassifyFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if ok != tt.ok {
				t.Fatalf("accepted = %v, want %v", ok, tt.ok)
			}
			if ok && got != tt.want {
				t.Fatalf("capability = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestBrowserVideoCompatibility(t *testing.T) {
	tests := []struct {
		mime, video, audio string
		want               bool
	}{
		{"video/mp4", "h264", "aac", true},
		{"video/mp4", "hevc", "aac", false},
		{"video/webm", "vp9", "opus", true},
		{"video/webm", "h264", "aac", false},
		{"video/quicktime", "h264", "aac", false},
	}
	for _, tt := range tests {
		if got := browserVideoCompatible(tt.mime, tt.video, tt.audio); got != tt.want {
			t.Errorf("browserVideoCompatible(%q, %q, %q) = %v, want %v", tt.mime, tt.video, tt.audio, got, tt.want)
		}
	}
}
