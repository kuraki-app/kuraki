// Package domain holds Kuraki's core entities and value types.
//
// Discipline (enforced from commit #1): this package performs NO I/O. It never
// touches os.*, the database, or the network directly. File access goes through
// the storage.Storage interface and image work through media.Processor. Keeping
// domain pure is what makes the future S3 backend (F-34) and multi-user work
// (F-30) cheap to add later.
package domain

import "time"

// MediaType distinguishes still images from videos.
type MediaType string

const (
	MediaImage MediaType = "image"
	MediaVideo MediaType = "video"
)

// DerivativeKind identifies a generated representation of an asset.
type DerivativeKind string

const (
	DerivativeThumb   DerivativeKind = "thumb"   // small grid thumbnail
	DerivativePreview DerivativeKind = "preview" // larger viewer preview
	DerivativePoster  DerivativeKind = "poster"  // video poster frame
)

// ExternalMetadata is what a foreign system knows about a media file that the
// file itself does not carry. Google Takeout supplies it from JSON sidecars;
// a library migration supplies it from the source server's API.
//
// The importer merges this over what it probes from the bytes. Pointer fields
// mean "unknown" when nil, so a provider can stay silent about a field instead
// of overwriting a good EXIF value with a zero.
type ExternalMetadata struct {
	TakenAt     *time.Time
	Lat         *float64
	Lon         *float64
	Description string
	Favorite    bool
	Rating      int // 0-5; 0 means unrated
	Archived    bool
	Hidden      bool
	CameraMake  string
	CameraModel string
}

// User is the single owner in Phase 1. owner_id is carried on every asset from
// day one so multi-user (F-30) is a data migration, not a rewrite.
type User struct {
	ID           string
	Username     string
	PasswordHash string
	CreatedAt    time.Time
}

// Asset is one imported photo or video. Originals are write-once (F-03): once
// OriginalPath is set at import, the bytes and path never change.
type Asset struct {
	ID           string // UUIDv7
	OwnerID      string // FK -> users.id
	ContentHash  string // BLAKE3 hex; dedup key (F-05)
	OriginalPath string // relative to the originals root, e.g. 2026/07/IMG_1234.jpg
	Filename     string
	MimeType     string
	MediaType    MediaType
	Width        int
	Height       int
	SizeBytes    int64
	TakenAt      *time.Time // from EXIF; nil if unknown
	CameraMake   string
	CameraModel  string
	GPSLat       *float64
	GPSLon       *float64
	DurationMS   int64 // videos only
	Favorite     bool
	Embedding    []byte // reserved for ML (F-32); always nil in Phase 1
	CreatedAt    time.Time
	DeletedAt    *time.Time // soft delete -> trash (F-10)
}
