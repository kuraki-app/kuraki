package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func gradient(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			v := uint8((x * 255) / w)
			img.Set(x, y, color.RGBA{v, v, v, 255})
		}
	}
	return img
}

func encJPEG(t *testing.T, img image.Image, q int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: q}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestPerceptualHash(t *testing.T) {
	img := gradient(200, 160)

	// The same image re-encoded at different quality (different bytes) should
	// produce the same or a very close perceptual hash.
	h1, ok1 := PerceptualHash(encJPEG(t, img, 90))
	h2, ok2 := PerceptualHash(encJPEG(t, img, 40))
	if !ok1 || !ok2 {
		t.Fatal("hash failed")
	}
	if d := Hamming(h1, h2); d > 4 {
		t.Errorf("re-encode hamming = %d, expected near 0", d)
	}

	// A visually different image should differ substantially.
	var other bytes.Buffer
	inv := image.NewRGBA(image.Rect(0, 0, 200, 160))
	for x := 0; x < 200; x++ {
		for y := 0; y < 160; y++ {
			v := uint8((y * 255) / 160)
			inv.Set(x, y, color.RGBA{v, v, v, 255})
		}
	}
	_ = png.Encode(&other, inv)
	h3, ok3 := PerceptualHash(other.Bytes())
	if !ok3 {
		t.Fatal("hash failed")
	}
	if d := Hamming(h1, h3); d < 10 {
		t.Errorf("different-image hamming = %d, expected large", d)
	}

	if _, ok := PerceptualHash([]byte("not an image")); ok {
		t.Error("expected decode failure")
	}
}
