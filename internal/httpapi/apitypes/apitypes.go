// Package apitypes holds the exported wire DTOs for the Kuraki HTTP API. It is
// a pure struct-declaration package (stdlib-only, no I/O) so it can be
// annotated with swag `@Success`/`@Param` comments and reflected by the
// OpenAPI codegen pipeline without pulling in server-side dependencies.
package apitypes

import "encoding/json"

// Error is the standard error envelope written by writeError.
type Error struct {
	Error string `json:"error" validate:"required"`
}

// AssetIDs is the request body for album add/remove and other id-batch endpoints.
type AssetIDs struct {
	IDs []string `json:"ids"`
}

// Asset is the wire representation of one asset (photo or video).
type Asset struct {
	ID           string   `json:"id" validate:"required"`
	Filename     string   `json:"filename" validate:"required"`
	MimeType     string   `json:"mime_type" validate:"required"`
	MediaType    string   `json:"media_type" validate:"required" enums:"image,video"`
	Width        int      `json:"width" validate:"required"`
	Height       int      `json:"height" validate:"required"`
	SizeBytes    int64    `json:"size_bytes" validate:"required"`
	TakenAt      *string  `json:"taken_at,omitempty"`
	TakenDay     *string  `json:"taken_day,omitempty"`
	TakenMonth   *string  `json:"taken_month,omitempty"`
	CameraMake   string   `json:"camera_make" validate:"required"`
	CameraModel  string   `json:"camera_model" validate:"required"`
	GPSLat       *float64 `json:"gps_lat,omitempty"`
	GPSLon       *float64 `json:"gps_lon,omitempty"`
	DurationMS   int64    `json:"duration_ms" validate:"required"`
	Favorite     bool     `json:"favorite" validate:"required"`
	Rating       int      `json:"rating" validate:"required"`
	Archived     bool     `json:"archived" validate:"required"`
	Hidden       bool     `json:"hidden" validate:"required"`
	Description  *string  `json:"description,omitempty"`
	PlaceCity    *string  `json:"place_city,omitempty"`
	PlaceCountry *string  `json:"place_country,omitempty"`
	OriginalURL  string   `json:"original_url" validate:"required"`
	ThumbnailURL *string  `json:"thumbnail_url,omitempty"`
	PreviewURL   *string  `json:"preview_url,omitempty"`
	ViewURL      string   `json:"view_url" validate:"required"`
	WebViewable  bool     `json:"web_viewable" validate:"required"`
	StackID      *string  `json:"stack_id,omitempty"`
	StackSize    int      `json:"stack_size" validate:"required"`
	CreatedAt    string   `json:"created_at" validate:"required"`
}

// AssetList is the envelope for a page of assets.
type AssetList struct {
	Assets     []Asset `json:"assets" validate:"required"`
	NextCursor string  `json:"next_cursor,omitempty"`
}

// User is the wire representation of the signed-in owner.
type User struct {
	ID       string `json:"id" validate:"required"`
	Username string `json:"username" validate:"required"`
	// Role is "admin" or "user". Admins manage accounts and server settings;
	// they cannot read another user's library.
	Role string `json:"role" validate:"required"`
}

// UserSummary is one account in the admin user list. It deliberately carries
// no library contents -- an admin manages accounts, not photos. AssetCount is
// included only so deletion can warn about what a purge would destroy.
type UserSummary struct {
	ID         string  `json:"id" validate:"required"`
	Username   string  `json:"username" validate:"required"`
	Role       string  `json:"role" validate:"required"`
	CreatedAt  string  `json:"created_at" validate:"required"`
	DisabledAt *string `json:"disabled_at,omitempty"`
	AssetCount int     `json:"asset_count" validate:"required"`
}

// UserList is the envelope for the admin user list.
type UserList struct {
	Users []UserSummary `json:"users" validate:"required"`
}

// UserCreate is the admin create-account request.
type UserCreate struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
	Role     string `json:"role,omitempty"`
}

// UserPatch updates an account. Every field is optional; nil means unchanged.
type UserPatch struct {
	Role     *string `json:"role,omitempty"`
	Disabled *bool   `json:"disabled,omitempty"`
	Password *string `json:"password,omitempty"`
}

// UserDeleteBlocked explains a refused deletion: the account still owns
// assets, and destroying a library requires explicit intent.
type UserDeleteBlocked struct {
	Error      string `json:"error" validate:"required"`
	AssetCount int    `json:"asset_count" validate:"required"`
}

// SetupStatus reports whether initial setup is required and, if signed in,
// the current user.
type SetupStatus struct {
	SetupRequired bool  `json:"setup_required" validate:"required"`
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
	ID         string `json:"id" validate:"required"`
	Name       string `json:"name" validate:"required"`
	AssetCount int    `json:"asset_count" validate:"required"`
	CreatedAt  string `json:"created_at" validate:"required"`
}

// AlbumList is the envelope for the album list endpoint.
type AlbumList struct {
	Albums []Album `json:"albums" validate:"required"`
}

// BatchRequest is the request body for the multi-select batch-op endpoint.
type BatchRequest struct {
	IDs []string `json:"ids"`
	// purge is permanent: it deletes the original from disk and the row from the
	// database. Every other op is reversible.
	Op string `json:"op"` // delete | restore | purge | favorite | unfavorite | archive | unarchive | hide | unhide
}

// BatchResponse reports the outcome of a batch operation.
type BatchResponse struct {
	Succeeded int               `json:"succeeded" validate:"required"`
	Failed    map[string]string `json:"failed,omitempty"`
}

// ServerAddresses lists the URLs a phone on the same network can reach this
// server on. The browser cannot work these out — it only knows what was typed
// into it — so the server reports them.
type ServerAddresses struct {
	Addresses []string `json:"addresses"`
}

// DeviceRequest is the request body for registering a device.
type DeviceRequest struct {
	Name string `json:"name"`
}

// DeviceResponse is the wire representation of a registered device.
type DeviceResponse struct {
	ID    string `json:"id" validate:"required"`
	Name  string `json:"name" validate:"required"`
	Token string `json:"token,omitempty"`
}

// CaptureStartRequest is the request body for starting a capture upload session.
type CaptureStartRequest struct {
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
	// TakenAt is when the client says the item was captured, RFC3339.
	//
	// Optional, and only a fallback: EXIF still wins, because it travels with
	// the file and the client's value is an assertion. It exists because a
	// phone knows its camera roll's creation times exactly while screenshots
	// and similar EXIF-less media carry none, and those imported with no date
	// at all — grouping under "Undated" in every client.
	TakenAt string `json:"taken_at,omitempty"`
}

// CaptureSessionResponse is the wire representation of a capture upload session.
type CaptureSessionResponse struct {
	ID            string `json:"id" validate:"required"`
	Filename      string `json:"filename" validate:"required"`
	SizeBytes     int64  `json:"size_bytes" validate:"required"`
	ReceivedBytes int64  `json:"received_bytes" validate:"required"`
	Status        string `json:"status" validate:"required"`
	JobID         string `json:"job_id,omitempty"`
	Error         string `json:"error,omitempty"`
}

// CaptureStatusResponse summarizes a device's in-flight capture sessions.
type CaptureStatusResponse struct {
	DeviceID  string                   `json:"device_id" validate:"required"`
	Receiving int                      `json:"receiving" validate:"required"`
	Queued    int                      `json:"queued" validate:"required"`
	Failed    int                      `json:"failed" validate:"required"`
	Sessions  []CaptureSessionResponse `json:"sessions" validate:"required"`
}

// ChangeEntry is one row of the owner-scoped delta feed.
type ChangeEntry struct {
	ID       int64  `json:"id" validate:"required"`
	Entity   string `json:"entity" validate:"required"`
	EntityID string `json:"entity_id" validate:"required"`
	Op       string `json:"op" validate:"required"`
}

// ChangesResponse is the envelope for the delta feed endpoint.
type ChangesResponse struct {
	Cursor  int64         `json:"cursor" validate:"required"`
	Changes []ChangeEntry `json:"changes" validate:"required"`
	HasMore bool          `json:"has_more" validate:"required"`
	// Reset is true when the client's cursor has fallen below the pruned
	// change_log floor: the client must discard its cursor/mirror and reload
	// from the asset endpoints, then resume from Cursor. Absent/false normally.
	Reset bool `json:"reset,omitempty"`
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
	ID           string  `json:"id" validate:"required"`
	Filename     string  `json:"filename" validate:"required"`
	SizeBytes    int64   `json:"size_bytes" validate:"required"`
	TakenAt      *string `json:"taken_at,omitempty"`
	ThumbnailURL *string `json:"thumbnail_url,omitempty"`
}

// AssetPatch is the request body for editing an asset's capture date,
// location, caption, or rating.
type AssetPatch struct {
	TakenAt     *string  `json:"taken_at"` // RFC3339; empty string clears
	GPSLat      *float64 `json:"gps_lat"`  // set with GPSLon
	GPSLon      *float64 `json:"gps_lon"`
	ClearGPS    bool     `json:"clear_gps"` // remove location
	Description *string  `json:"description"`
	// Rating is 0-5, where 0 means unrated. It was filterable and returned on
	// every asset long before anything could set it: only the importer and the
	// Immich migration ever wrote the column, so a rating could be searched for
	// but never given.
	Rating *int `json:"rating"`
}

// ShiftRequest is the request body for shifting many assets' capture time by
// a fixed offset.
type ShiftRequest struct {
	IDs     []string `json:"ids"`
	Minutes int      `json:"minutes"` // may be negative
}

// ExternalLibrary is the wire representation of a linked external library.
type ExternalLibrary struct {
	ID         string `json:"id" validate:"required"`
	Name       string `json:"name" validate:"required"`
	RootPath   string `json:"root_path" validate:"required"`
	CreatedAt  string `json:"created_at" validate:"required"`
	AssetCount int    `json:"asset_count" validate:"required"`
}

// ExternalLibraryRequest is the request body for linking an external library.
type ExternalLibraryRequest struct {
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
}

// ExternalLibraryList is the envelope for the external library list endpoint.
type ExternalLibraryList struct {
	Libraries []ExternalLibrary `json:"libraries" validate:"required"`
}

// FavoriteRequest is the request body for setting an asset's favorite flag.
type FavoriteRequest struct {
	Favorite bool `json:"favorite"`
}

// Job is the wire representation of an import job.
type Job struct {
	ID         string `json:"id" validate:"required"`
	Kind       string `json:"kind" validate:"required"`
	Status     string `json:"status" validate:"required" enums:"queued,running,succeeded,failed"`
	Total      int    `json:"total" validate:"required"`
	Imported   int    `json:"imported" validate:"required"`
	Duplicates int    `json:"duplicates" validate:"required"`
	Skipped    int    `json:"skipped" validate:"required"`
	Errors     int    `json:"errors" validate:"required"`
	Attempts   int    `json:"attempts" validate:"required"`
	Error      string `json:"error,omitempty"`
	CreatedAt  string `json:"created_at" validate:"required"`
	UpdatedAt  string `json:"updated_at" validate:"required"`
}

// JobList is the envelope for the job list endpoint.
type JobList struct {
	Jobs []Job `json:"jobs" validate:"required"`
}

// JobError is one per-file error recorded against a job.
type JobError struct {
	Filename string `json:"filename" validate:"required"`
	Error    string `json:"error" validate:"required"`
}

// JobDetail is a job plus its per-file errors. Job is embedded so its fields
// flatten into the JSON object exactly as the pre-refactor embedded jobDTO did.
type JobDetail struct {
	Job
	ErrorsDetail []JobError `json:"errors_detail" validate:"required"`
}

// MediaIssue is a durable derivative-generation failure for one asset.
type MediaIssue struct {
	AssetID   string `json:"asset_id" validate:"required"`
	Filename  string `json:"filename" validate:"required"`
	MediaType string `json:"media_type" validate:"required" enums:"image,video"`
	Kind      string `json:"kind" validate:"required"`
	Message   string `json:"message" validate:"required"`
	CreatedAt string `json:"created_at" validate:"required"`
}

// MediaIssueList is the envelope for the media health endpoint.
type MediaIssueList struct {
	Issues []MediaIssue `json:"issues" validate:"required"`
}

// Tag is the wire representation of a user tag.
type Tag struct {
	ID       string  `json:"id" validate:"required"`
	Name     string  `json:"name" validate:"required"`
	ParentID *string `json:"parent_id,omitempty"`
}

// TagList is the envelope for tag list endpoints.
type TagList struct {
	Tags []Tag `json:"tags" validate:"required"`
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
	ID        string          `json:"id" validate:"required"`
	Name      string          `json:"name" validate:"required"`
	Query     json.RawMessage `json:"query" swaggertype:"object" validate:"required"`
	CreatedAt string          `json:"created_at" validate:"required"`
}

// SavedSearchList is the envelope for the saved search list endpoint.
type SavedSearchList struct {
	SavedSearches []SavedSearch `json:"saved_searches" validate:"required"`
}

// SavedSearchRequest is the request body for creating a saved search.
type SavedSearchRequest struct {
	Name  string          `json:"name"`
	Query json.RawMessage `json:"query" swaggertype:"object"`
}

// PairingCodeResponse is the wire representation of a freshly minted pairing code.
type PairingCodeResponse struct {
	Code      string `json:"code" validate:"required"`
	ExpiresAt string `json:"expires_at" validate:"required"`
}

// PairClaimRequest is the request body for redeeming a pairing code.
type PairClaimRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// PlaceGroup is one place (city/country) with an asset count and cover thumb.
type PlaceGroup struct {
	City          string `json:"city" validate:"required"`
	Country       string `json:"country" validate:"required"`
	Count         int    `json:"count" validate:"required"`
	CoverAssetID  string `json:"cover_asset_id" validate:"required"`
	CoverThumbURL string `json:"cover_thumb_url" validate:"required"`
}

// PlaceSummary is the envelope for the places-summary endpoint.
type PlaceSummary struct {
	Places []PlaceGroup `json:"places" validate:"required"`
}

// YearCount is one year's asset count for the library stats breakdown.
type YearCount struct {
	Year  string `json:"year" validate:"required"`
	Count int    `json:"count" validate:"required"`
}

// LibraryStats reports library totals for the dashboard.
type LibraryStats struct {
	Total      int         `json:"total" validate:"required"`
	Images     int         `json:"images" validate:"required"`
	Videos     int         `json:"videos" validate:"required"`
	Favorites  int         `json:"favorites" validate:"required"`
	Trashed    int         `json:"trashed" validate:"required"`
	Albums     int         `json:"albums" validate:"required"`
	Places     int         `json:"places" validate:"required"`
	TotalBytes int64       `json:"total_bytes" validate:"required"`
	ByYear     []YearCount `json:"by_year" validate:"required"`
	// Filesystem holding the data directory. Both are omitted together when the
	// platform or storage backend cannot report them — clients must render
	// "unknown", never zero, because 0 bytes free reads as a full disk.
	//
	// DiskFreeBytes is what this process may actually use, not the raw free
	// blocks: unix filesystems reserve a slice for root and Windows applies
	// per-user quotas, and promising either would turn into a failed write.
	DiskFreeBytes  int64 `json:"disk_free_bytes,omitempty"`
	DiskTotalBytes int64 `json:"disk_total_bytes,omitempty"`
}

// SettingInfo describes one server setting for GET /api/settings: its
// current value, default, type/bounds metadata, and whether the environment
// pins it read-only. Secret settings (metrics_token) never carry their real
// value here — Value is always "" for them; IsSet says whether one exists.
type SettingInfo struct {
	Key         string `json:"key" validate:"required"`
	Value       string `json:"value"`
	Default     string `json:"default"`
	Type        string `json:"type" validate:"required" enums:"int,bool,string,path"`
	Unit        string `json:"unit,omitempty"`
	Apply       string `json:"apply" validate:"required" enums:"live,restart"`
	PinnedByEnv bool   `json:"pinned_by_env,omitempty"`
	EnvVar      string `json:"env_var" validate:"required"`
	Min         int    `json:"min,omitempty"`
	Max         int    `json:"max,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
	IsSet       bool   `json:"is_set,omitempty"`
}

// SettingsResponse is the envelope for GET /api/settings.
type SettingsResponse struct {
	Version        string        `json:"version" validate:"required"`
	RestartPending []string      `json:"restart_pending"`
	Settings       []SettingInfo `json:"settings" validate:"required"`
}

// SettingsPatchRequest is a partial key/value map for PATCH /api/settings;
// keys are SettingInfo.Key values, values are the raw (pre-validation) string.
type SettingsPatchRequest map[string]string

// SettingRejection reports why one PATCH key was not applied.
type SettingRejection struct {
	Key   string `json:"key" validate:"required"`
	Error string `json:"error" validate:"required"`
}

// SettingWarning reports a non-fatal issue with an applied PATCH key (e.g.
// OCR enabled without tesseract on PATH).
type SettingWarning struct {
	Key     string `json:"key" validate:"required"`
	Warning string `json:"warning" validate:"required"`
}

// SettingsPatchResponse reports the per-key outcome of a settings save.
type SettingsPatchResponse struct {
	Applied        []string           `json:"applied"`
	PendingRestart []string           `json:"pending_restart"`
	Rejected       []SettingRejection `json:"rejected,omitempty"`
	Warnings       []SettingWarning   `json:"warnings,omitempty"`
}

// DeviceInfo is the wire representation of a paired device for the list
// endpoint — unlike DeviceResponse, it never carries a token.
type DeviceInfo struct {
	ID         string  `json:"id" validate:"required"`
	Name       string  `json:"name" validate:"required"`
	CreatedAt  string  `json:"created_at" validate:"required"`
	LastSeenAt *string `json:"last_seen_at,omitempty"`
}

// DeviceList is the envelope for GET /api/devices.
type DeviceList struct {
	Devices []DeviceInfo `json:"devices" validate:"required"`
}
