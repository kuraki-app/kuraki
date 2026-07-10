package media

import (
	"bytes"
	"image"
	"math/bits"

	"golang.org/x/image/draw"
)

// PerceptualHash computes a 64-bit difference hash (dHash) from encoded image
// bytes. It is tolerant of re-encoding and resizing, so visually identical
// copies that differ byte-for-byte (and therefore survive content-hash dedup)
// share a hash. ok is false if the bytes cannot be decoded as an image.
//
// Computing it from the generated thumbnail means every imaged asset — even
// HEIC/RAW — gets a hash, since the thumbnail is always a web-decodable format.
func PerceptualHash(data []byte) (uint64, bool) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, false
	}
	return dHash(img), true
}

// dHash downscales to 9x8 grayscale and encodes, for each row, whether each
// pixel is brighter than its right neighbour (8x8 = 64 comparisons).
func dHash(img image.Image) uint64 {
	small := image.NewGray(image.Rect(0, 0, 9, 8))
	draw.CatmullRom.Scale(small, small.Bounds(), img, img.Bounds(), draw.Over, nil)

	var hash uint64
	bit := 0
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			if small.GrayAt(x, y).Y < small.GrayAt(x+1, y).Y {
				hash |= 1 << uint(bit)
			}
			bit++
		}
	}
	return hash
}

// Hamming is the number of differing bits between two perceptual hashes; 0 means
// identical structure, and small values indicate near-duplicates.
func Hamming(a, b uint64) int {
	return bits.OnesCount64(a ^ b)
}
