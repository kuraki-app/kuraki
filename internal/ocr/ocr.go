// Package ocr provides opt-in, fully local text recognition for images by
// shelling out to the tesseract binary — the same feature-detected, no-CGO,
// no-cloud pattern Kuraki uses for ffmpeg. When tesseract is absent the feature
// is simply unavailable; nothing is uploaded anywhere.
package ocr

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Available reports whether the tesseract binary is on PATH.
func Available() bool {
	_, err := exec.LookPath("tesseract")
	return err == nil
}

// RecognizeBytes writes the image to a temporary file and runs tesseract over
// it, returning the recognised text (may be empty for an image with no text).
// The suffix should reflect the image format (for example ".jpg") so leptonica
// picks the right decoder.
func RecognizeBytes(ctx context.Context, data []byte, suffix string) (string, error) {
	if suffix == "" {
		suffix = ".png"
	}
	tmp, err := os.CreateTemp("", "kuraki-ocr-*"+suffix)
	if err != nil {
		return "", fmt.Errorf("ocr: temp file: %w", err)
	}
	path := tmp.Name()
	defer os.Remove(path)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", fmt.Errorf("ocr: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("ocr: close temp: %w", err)
	}
	return recognizeFile(ctx, path)
}

func recognizeFile(ctx context.Context, path string) (string, error) {
	// "stdout" makes tesseract emit recognised text to standard output; -l eng
	// selects the bundled English model.
	cmd := exec.CommandContext(ctx, "tesseract", path, "stdout", "-l", "eng")
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ocr: tesseract %s: %w: %s", filepath.Base(path), err, strings.TrimSpace(errBuf.String()))
	}
	return normalize(out.String()), nil
}

// normalize collapses tesseract's whitespace into single-spaced text so it
// stores compactly and indexes cleanly.
func normalize(text string) string {
	return strings.Join(strings.Fields(text), " ")
}
