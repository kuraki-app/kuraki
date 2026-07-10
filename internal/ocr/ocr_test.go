package ocr

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

func TestNormalizeCollapsesWhitespace(t *testing.T) {
	got := normalize("  hello \n\n world\t tab  ")
	if got != "hello world tab" {
		t.Fatalf("normalize = %q", got)
	}
}

func TestRecognizeBytesReadsText(t *testing.T) {
	if !Available() {
		t.Skip("tesseract not installed")
	}
	img := image.NewRGBA(image.Rect(0, 0, 300, 80))
	for i := range img.Pix {
		img.Pix[i] = 0xff // white background
	}
	drawer := &font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(color.Black),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(20, 45),
	}
	drawer.DrawString("HELLO KURAKI")

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	text, err := RecognizeBytes(context.Background(), buf.Bytes(), ".png")
	if err != nil {
		t.Fatalf("recognize: %v", err)
	}
	if text == "" {
		t.Fatal("expected some recognised text")
	}
}
