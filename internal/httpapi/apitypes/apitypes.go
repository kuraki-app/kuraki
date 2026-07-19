// Package apitypes holds the exported wire DTOs for the Kuraki HTTP API. It is
// a pure struct-declaration package (stdlib-only, no I/O) so it can be
// annotated with swag `@Success`/`@Param` comments and reflected by the
// OpenAPI codegen pipeline without pulling in server-side dependencies.
package apitypes

import "encoding/json"

// Error is the standard error envelope written by writeError.
type Error struct {
	Error string `json:"error"`
}

// AssetIDs is the request body for album add/remove and other id-batch endpoints.
type AssetIDs struct {
	IDs []string `json:"ids"`
}

// Asset is the wire representation of one asset (photo or video).
type Asset struct {
	ID           string   `json:"id"`
	Filename     string   `json:"filename"`
	MimeType     string   `json:"mime_type"`
	MediaType    string   `json:"media_type"`
	Width        int      `json:"width"`
	Height       int      `json:"height"`
	SizeBytes    int64    `json:"size_bytes"`
	TakenAt      *string  `json:"taken_at,omitempty"`
	TakenDay     *string  `json:"taken_day,omitempty"`
	TakenMonth   *string  `json:"taken_month,omitempty"`
	CameraMake   string   `json:"camera_make"`
	CameraModel  string   `json:"camera_model"`
	GPSLat       *float64 `json:"gps_lat,omitempty"`
	GPSLon       *float64 `json:"gps_lon,omitempty"`
	DurationMS   int64    `json:"duration_ms"`
	Favorite     bool     `json:"favorite"`
	Rating       int      `json:"rating"`
	Archived     bool     `json:"archived"`
	Hidden       bool     `json:"hidden"`
	Description  *string  `json:"description,omitempty"`
	PlaceCity    *string  `json:"place_city,omitempty"`
	PlaceCountry *string  `json:"place_country,omitempty"`
	OriginalURL  string   `json:"original_url"`
	ThumbnailURL *string  `json:"thumbnail_url,omitempty"`
	PreviewURL   *string  `json:"preview_url,omitempty"`
	ViewURL      string   `json:"view_url"`
	WebViewable  bool     `json:"web_viewable"`
	StackID      *string  `json:"stack_id,omitempty"`
	StackSize    int      `json:"stack_size"`
	CreatedAt    string   `json:"created_at"`
}

// AssetList is the envelope for a page of assets.
type AssetList struct {
	Assets     []Asset `json:"assets"`
	NextCursor string  `json:"next_cursor,omitempty"`
}

// User is the wire representation of the signed-in owner.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// SetupStatus reports whether initial setup is required and, if signed in,
// the current user.
type SetupStatus struct {
	SetupRequired bool  `json:"setup_required"`
	User          *User `json:"user,omitempty"`
}

// Credentials is the request body for setup and login.
type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// ChangePasswordRequest is the request body for rotating the owner's password.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// AlbumRequest is the request body for creating or renaming an album.
type AlbumRequest struct {
	Name string `json:"name"`
}

// Album is the wire representation of an album.
type Album struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AssetCount int    `json:"asset_count"`
	CreatedAt  string `json:"created_at"`
}

// AlbumList is the envelope for the album list endpoint.
type AlbumList struct {
	Albums []Album `json:"albums"`
}

// BatchRequest is the request body for the multi-select batch-op endpoint.
type BatchRequest struct {
	IDs []string `json:"ids"`
	Op  string   `json:"op"` // delete | restore | favorite | unfavorite | archive | unarchive | hide | unhide
}

// BatchResponse reports the outcome of a batch operation.
type BatchResponse struct {
	Succeeded int               `json:"succeeded"`
	Failed    map[string]string `json:"failed,omitempty"`
}

// DeviceRequest is the request body for registering a device.
type DeviceRequest struct {
	Name string `json:"name"`
}

// DeviceResponse is the wire representation of a registered device.
type DeviceResponse struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token,omitempty"`
}

// CaptureStartRequest is the request body for starting a capture upload session.
type CaptureStartRequest struct {
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
}

// CaptureSessionResponse is the wire representation of a capture upload session.
type CaptureSessionResponse struct {
	ID            string `json:"id"`
	Filename      string `json:"filename"`
	SizeBytes     int64  `json:"size_bytes"`
	ReceivedBytes int64  `json:"received_bytes"`
	Status        string `json:"status"`
	JobID         string `json:"job_id,omitempty"`
	Error         string `json:"error,omitempty"`
}

// CaptureStatusResponse summarizes a device's in-flight capture sessions.
type CaptureStatusResponse struct {
	DeviceID  string                   `json:"device_id"`
	Receiving int                      `json:"receiving"`
	Queued    int                      `json:"queued"`
	Failed    int                      `json:"failed"`
	Sessions  []CaptureSessionResponse `json:"sessions"`
}

// ChangeEntry is one row of the owner-scoped delta feed.
type ChangeEntry struct {
	ID       int64  `json:"id"`
	Entity   string `json:"entity"`
	EntityID string `json:"entity_id"`
	Op       string `json:"op"`
}

// ChangesResponse is the envelope for the delta feed endpoint.
type ChangesResponse struct {
	Cursor  int64         `json:"cursor"`
	Changes []ChangeEntry `json:"changes"`
	HasMore bool          `json:"has_more"`
}

// ZipRequest is the request body for the zip-download endpoints.
type ZipRequest struct {
	IDs []string `json:"ids"`
}

// ZipItem describes one entry to stream into a zip archive.
type ZipItem struct {
	StoragePath string // path within the store, e.g. originals/2026/07/x.jpg
	ZipName     string // entry name inside the archive
}

// DupAsset is the wire representation of an asset inside a duplicate group.
type DupAsset struct {
	ID           string  `json:"id"`
	Filename     string  `json:"filename"`
	SizeBytes    int64   `json:"size_bytes"`
	TakenAt      *string `json:"taken_at,omitempty"`
	ThumbnailURL *string `json:"thumbnail_url,omitempty"`
}

// AssetPatch is the request body for editing an asset's capture date,
// location, or caption.
type AssetPatch struct {
	TakenAt     *string  `json:"taken_at"` // RFC3339; empty string clears
	GPSLat      *float64 `json:"gps_lat"`  // set with GPSLon
	GPSLon      *float64 `json:"gps_lon"`
	ClearGPS    bool     `json:"clear_gps"` // remove location
	Description *string  `json:"description"`
}

// ShiftRequest is the request body for shifting many assets' capture time by
// a fixed offset.
type ShiftRequest struct {
	IDs     []string `json:"ids"`
	Minutes int      `json:"minutes"` // may be negative
}

// ExternalLibrary is the wire representation of a linked external library.
type ExternalLibrary struct {
	ID, Name, RootPath, CreatedAt string
	AssetCount                    int `json:"asset_count"`
}

// ExternalLibraryRequest is the request body for linking an external library.
type ExternalLibraryRequest struct {
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
}

// ExternalLibraryList is the envelope for the external library list endpoint.
type ExternalLibraryList struct {
	Libraries []ExternalLibrary `json:"libraries"`
}

// FavoriteRequest is the request body for setting an asset's favorite flag.
type FavoriteRequest struct {
	Favorite bool `json:"favorite"`
}

// Job is the wire representation of an import job.
type Job struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Status     string `json:"status"`
	Total      int    `json:"total"`
	Imported   int    `json:"imported"`
	Duplicates int    `json:"duplicates"`
	Skipped    int    `json:"skipped"`
	Errors     int    `json:"errors"`
	Attempts   int    `json:"attempts"`
	Error      string `json:"error,omitempty"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// JobList is the envelope for the job list endpoint.
type JobList struct {
	Jobs []Job `json:"jobs"`
}

// JobError is one per-file error recorded against a job.
type JobError struct {
	Filename string `json:"filename"`
	Error    string `json:"error"`
}

// JobDetail is a job plus its per-file errors. Job is embedded so its fields
// flatten into the JSON object exactly as the pre-refactor embedded jobDTO did.
type JobDetail struct {
	Job
	ErrorsDetail []JobError `json:"errors_detail"`
}

// MediaIssue is a durable derivative-generation failure for one asset.
type MediaIssue struct {
	AssetID   string `json:"asset_id"`
	Filename  string `json:"filename"`
	MediaType string `json:"media_type"`
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}

// MediaIssueList is the envelope for the media health endpoint.
type MediaIssueList struct {
	Issues []MediaIssue `json:"issues"`
}

// Tag is the wire representation of a user tag.
type Tag struct {
	ID, Name string
	ParentID *string `json:"parent_id,omitempty"`
}

// TagList is the envelope for tag list endpoints.
type TagList struct {
	Tags []Tag `json:"tags"`
}

// TagRequest is the request body for creating a tag.
type TagRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

// AssetTagsRequest is the request body for replacing an asset's tag set.
type AssetTagsRequest struct {
	IDs []string `json:"ids"`
}

// SavedSearch is the wire representation of a saved search.
type SavedSearch struct {
	ID, Name  string
	Query     json.RawMessage `json:"query" swaggertype:"object"`
	CreatedAt string          `json:"created_at"`
}

// SavedSearchList is the envelope for the saved search list endpoint.
type SavedSearchList struct {
	SavedSearches []SavedSearch `json:"saved_searches"`
}

// SavedSearchRequest is the request body for creating a saved search.
type SavedSearchRequest struct {
	Name  string          `json:"name"`
	Query json.RawMessage `json:"query" swaggertype:"object"`
}

// PairingCodeResponse is the wire representation of a freshly minted pairing code.
type PairingCodeResponse struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expires_at"`
}

// PairClaimRequest is the request body for redeeming a pairing code.
type PairClaimRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// PlaceGroup is one place (city/country) with an asset count and cover thumb.
type PlaceGroup struct {
	City          string `json:"city"`
	Country       string `json:"country"`
	Count         int    `json:"count"`
	CoverAssetID  string `json:"cover_asset_id"`
	CoverThumbURL string `json:"cover_thumb_url"`
}

// PlaceSummary is the envelope for the places-summary endpoint.
type PlaceSummary struct {
	Places []PlaceGroup `json:"places"`
}

// YearCount is one year's asset count for the library stats breakdown.
type YearCount struct {
	Year  string `json:"year"`
	Count int    `json:"count"`
}

// LibraryStats reports library totals for the dashboard.
type LibraryStats struct {
	Total      int         `json:"total"`
	Images     int         `json:"images"`
	Videos     int         `json:"videos"`
	Favorites  int         `json:"favorites"`
	Trashed    int         `json:"trashed"`
	Albums     int         `json:"albums"`
	Places     int         `json:"places"`
	TotalBytes int64       `json:"total_bytes"`
	ByYear     []YearCount `json:"by_year"`
}
