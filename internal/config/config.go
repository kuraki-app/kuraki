// Package config resolves Kuraki's runtime configuration.
//
// Kuraki is zero-config by design (F-02): with no flags and no environment
// variables it picks sensible defaults so a new user never edits YAML to get
// started. Precedence is defaults < environment < explicit flags, with flag
// wiring handled by the CLI layer.
package config

import (
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds everything the server and CLI need to locate data and listen
// for connections. It is intentionally small; anything derivable is derived.
type Config struct {
	// DataDir is the root of the Kuraki library: database, originals,
	// derivatives, trash, and pre-migration snapshots all live under it.
	DataDir string

	// Addr is the HTTP listen address, e.g. ":3000".
	Addr string

	// TrashRetentionDays is how long soft-deleted items stay before purge.
	TrashRetentionDays int

	// ThumbnailSize is the longest-edge pixel size for generated thumbnails.
	ThumbnailSize int

	// OCREnabled turns on the opt-in local OCR worker (requires the tesseract
	// binary on PATH). Off by default; nothing leaves the machine.
	OCREnabled bool

	// SecureCookies marks the session cookie Secure so browsers only send it
	// over HTTPS. Enable it in production behind TLS (KURAKI_SECURE_COOKIES=1).
	SecureCookies bool

	// TrustProxy makes Kuraki derive the client IP from X-Forwarded-For /
	// X-Real-IP headers. Only enable it when Kuraki runs behind a trusted
	// reverse proxy that sets those headers (KURAKI_TRUST_PROXY=1); when Kuraki
	// is directly exposed, leaving it off prevents clients from spoofing their
	// address to bypass the per-IP login and pairing rate limits.
	TrustProxy bool

	// MetricsToken, when set, allows scrapers to read /metrics with an
	// "Authorization: Bearer <token>" header (KURAKI_METRICS_TOKEN). Regardless
	// of this value, a logged-in owner session may always read /metrics; an
	// unauthenticated request with no matching token is rejected.
	MetricsToken string

	// BackupDir, when set, turns on unattended library backups: the server
	// writes a SQLite-consistent archive into this directory on an interval so a
	// passive user always has a recent backup (KURAKI_BACKUP_DIR). Empty (the
	// default) leaves backups fully manual via `kuraki backup`.
	BackupDir string

	// BackupIntervalHours is how often the unattended backup runs when BackupDir
	// is set (KURAKI_BACKUP_INTERVAL_HOURS, default 24).
	BackupIntervalHours int

	// BackupKeep is how many recent automatic archives to retain before older
	// ones are pruned (KURAKI_BACKUP_KEEP, default 7).
	BackupKeep int

	// AndroidAPK is an optional override for the Android app package served at
	// /download/android (KURAKI_ANDROID_APK). Empty (the default) uses
	// AndroidAPKPath() under the data dir; the endpoint 404s when no file exists.
	AndroidAPK string
}

// Default returns the zero-config configuration used when nothing overrides it.
func Default() Config {
	return Config{
		DataDir:             "./kuraki-data",
		Addr:                ":3000",
		TrashRetentionDays:  30,
		ThumbnailSize:       512,
		BackupIntervalHours: 24,
		BackupKeep:          7,
	}
}

// Load returns Default() with any KURAKI_* environment overrides applied.
// Flags are layered on top of this by the CLI.
func Load(getenv func(string) string) Config {
	c := Default()
	if v := getenv("KURAKI_DATA_DIR"); v != "" {
		c.DataDir = v
	}
	if v := getenv("KURAKI_ADDR"); v != "" {
		c.Addr = v
	}
	if n, ok := positiveInt(getenv("KURAKI_TRASH_RETENTION_DAYS")); ok {
		c.TrashRetentionDays = n
	}
	if n, ok := positiveInt(getenv("KURAKI_THUMBNAIL_SIZE")); ok {
		c.ThumbnailSize = n
	}
	if boolEnv(getenv("KURAKI_OCR")) {
		c.OCREnabled = true
	}
	if boolEnv(getenv("KURAKI_SECURE_COOKIES")) {
		c.SecureCookies = true
	}
	if boolEnv(getenv("KURAKI_TRUST_PROXY")) {
		c.TrustProxy = true
	}
	if v := strings.TrimSpace(getenv("KURAKI_METRICS_TOKEN")); v != "" {
		c.MetricsToken = v
	}
	if v := strings.TrimSpace(getenv("KURAKI_BACKUP_DIR")); v != "" {
		c.BackupDir = v
	}
	if n, ok := positiveInt(getenv("KURAKI_BACKUP_INTERVAL_HOURS")); ok {
		c.BackupIntervalHours = n
	}
	if n, ok := positiveInt(getenv("KURAKI_BACKUP_KEEP")); ok {
		c.BackupKeep = n
	}
	if v := strings.TrimSpace(getenv("KURAKI_ANDROID_APK")); v != "" {
		c.AndroidAPK = v
	}
	return c
}

// boolEnv reads a truthy environment value (1/true/yes/on).
func boolEnv(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func positiveInt(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

// DBPath is the SQLite database file inside the data directory.
func (c Config) DBPath() string { return filepath.Join(c.DataDir, "kuraki.db") }

// OriginalsDir is where write-once original files are stored (F-03).
func (c Config) OriginalsDir() string { return filepath.Join(c.DataDir, "originals") }

// DerivativesDir is where generated thumbnails/previews/posters live (F-07).
func (c Config) DerivativesDir() string { return filepath.Join(c.DataDir, "derivatives") }

// TrashDir holds soft-deleted originals during the 30-day retention window (F-10).
func (c Config) TrashDir() string { return filepath.Join(c.DataDir, "trash") }

// SnapshotsDir holds timestamped DB backups taken before each migration (F-11).
func (c Config) SnapshotsDir() string { return filepath.Join(c.DataDir, "snapshots") }

// StagingDir holds uploaded files awaiting background import.
func (c Config) StagingDir() string { return filepath.Join(c.DataDir, "staging") }

// DownloadsDir holds operator-supplied artifacts served under /download,
// currently the Android app package.
func (c Config) DownloadsDir() string { return filepath.Join(c.DataDir, "downloads") }

// AndroidAPKPath is the file served at /download/android: the KURAKI_ANDROID_APK
// override when set, otherwise kuraki-android.apk under DownloadsDir. The file
// need not exist — the endpoint 404s until an operator drops one in.
func (c Config) AndroidAPKPath() string {
	if c.AndroidAPK != "" {
		return c.AndroidAPK
	}
	return filepath.Join(c.DownloadsDir(), "kuraki-android.apk")
}
