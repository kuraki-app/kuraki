package config

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// SettingKey identifies one DB-backed, admin-writable server setting. It is
// the string stored as server_settings.key, so values are stable API/wire
// identifiers, not free-form labels.
type SettingKey string

const (
	KeyTrashRetentionDays  SettingKey = "trash_retention_days"
	KeyChangeLogKeep       SettingKey = "change_log_keep"
	KeyThumbnailSize       SettingKey = "thumbnail_size"
	KeyOCREnabled          SettingKey = "ocr_enabled"
	KeyBackupDir           SettingKey = "backup_dir"
	KeyBackupIntervalHours SettingKey = "backup_interval_hours"
	KeyBackupKeep          SettingKey = "backup_keep"
	KeyMetricsToken        SettingKey = "metrics_token"
	KeyAndroidAPK          SettingKey = "android_apk"
)

// Apply describes when a saved setting change takes effect. Most of the
// catalog is "restart": the value is baked into a constructor (queue.New,
// httpapi.Deps) at Serve() time and is never re-read afterwards. Only two
// keys are read per-call by their background worker and so can apply live —
// see App.PurgeTrash / App.PruneChangeLog in internal/app.
type Apply string

const (
	ApplyLive    Apply = "live"
	ApplyRestart Apply = "restart"
)

// SettingType is the wire/UI data type of a setting's value. Values are
// always stored and transmitted as strings; Type tells the caller how to
// parse and render them.
type SettingType string

const (
	TypeInt    SettingType = "int"
	TypeBool   SettingType = "bool"
	TypeString SettingType = "string"
	TypePath   SettingType = "path"
)

// SettingDescriptor documents one writable server setting. This is the single
// catalog: httpapi serializes it for GET /api/settings and the web UI renders
// entirely from it, so the UI's labels/bounds/lock state can never drift from
// the validation rules ValidateSetting enforces.
type SettingDescriptor struct {
	Key    SettingKey
	EnvVar string
	Type   SettingType
	Unit   string // "days", "px", "hours", "rows", "archives" — empty when N/A
	Apply  Apply
	Secret bool // masked on the wire (metrics_token); see httpapi settings.go
	Min    int  // TypeInt only; 0 means no floor
	Max    int  // TypeInt only; 0 means no ceiling
}

// Catalog is the ordered list of every writable server setting.
var Catalog = []SettingDescriptor{
	{Key: KeyTrashRetentionDays, EnvVar: "KURAKI_TRASH_RETENTION_DAYS", Type: TypeInt, Unit: "days", Apply: ApplyLive, Min: 1},
	{Key: KeyChangeLogKeep, EnvVar: "KURAKI_CHANGELOG_KEEP", Type: TypeInt, Unit: "rows", Apply: ApplyLive, Min: 1000},
	{Key: KeyThumbnailSize, EnvVar: "KURAKI_THUMBNAIL_SIZE", Type: TypeInt, Unit: "px", Apply: ApplyRestart, Min: 64, Max: 4096},
	{Key: KeyOCREnabled, EnvVar: "KURAKI_OCR", Type: TypeBool, Apply: ApplyRestart},
	{Key: KeyBackupDir, EnvVar: "KURAKI_BACKUP_DIR", Type: TypePath, Apply: ApplyRestart},
	{Key: KeyBackupIntervalHours, EnvVar: "KURAKI_BACKUP_INTERVAL_HOURS", Type: TypeInt, Unit: "hours", Apply: ApplyRestart, Min: 1},
	{Key: KeyBackupKeep, EnvVar: "KURAKI_BACKUP_KEEP", Type: TypeInt, Unit: "archives", Apply: ApplyRestart, Min: 1},
	{Key: KeyMetricsToken, EnvVar: "KURAKI_METRICS_TOKEN", Type: TypeString, Apply: ApplyRestart, Secret: true},
	{Key: KeyAndroidAPK, EnvVar: "KURAKI_ANDROID_APK", Type: TypePath, Apply: ApplyRestart},
}

var descriptorByKey = func() map[SettingKey]SettingDescriptor {
	m := make(map[SettingKey]SettingDescriptor, len(Catalog))
	for _, d := range Catalog {
		m[d.Key] = d
	}
	return m
}()

// CatalogKey looks up a descriptor by its wire key (e.g. from a PATCH body).
func CatalogKey(key string) (SettingDescriptor, bool) {
	d, ok := descriptorByKey[SettingKey(key)]
	return d, ok
}

// settingEnvVars is every KURAKI_* variable EnvPresent checks: exactly the
// catalog's env vars, kept as its own slice so presence-checking never has to
// import strconv/strings again to re-derive the list.
var settingEnvVars = func() []string {
	names := make([]string, 0, len(Catalog))
	for _, d := range Catalog {
		names = append(names, d.EnvVar)
	}
	return names
}()

// EnvPresent returns the set of catalog KURAKI_* variable names that have a
// non-empty value in the environment. Presence, not effect: boolEnv (used by
// Load) only turns a bool on for a truthy value, so KURAKI_OCR=0 does not
// enable OCR — but it must still count as "present", or a DB row could
// silently override an operator's explicit off switch.
func EnvPresent(getenv func(string) string) map[string]bool {
	present := make(map[string]bool, len(settingEnvVars))
	for _, name := range settingEnvVars {
		if getenv(name) != "" {
			present[name] = true
		}
	}
	return present
}

// PinnedKeys returns the writable setting keys whose backing environment
// variable is present, in catalog order. Pinning depends only on the
// environment, never on whether a DB row exists.
func PinnedKeys(envPresent map[string]bool) []string {
	var pinned []string
	for _, d := range Catalog {
		if envPresent[d.EnvVar] {
			pinned = append(pinned, string(d.Key))
		}
	}
	return pinned
}

// ApplyDB layers DB-stored settings onto cfg, skipping any key whose
// environment variable is present in envPresent — so precedence resolves to
// defaults < DB < env < flags, given a cfg that already has env and flags
// applied (as config.Load + CLI flag overrides produce). A row that exists
// with an empty value is an explicit "clear this" and is honoured; a key with
// no row at all is left untouched.
func ApplyDB(cfg Config, rows map[string]string, envPresent map[string]bool) Config {
	for _, d := range Catalog {
		if envPresent[d.EnvVar] {
			continue
		}
		v, ok := rows[string(d.Key)]
		if !ok {
			continue
		}
		switch d.Key {
		case KeyTrashRetentionDays:
			if n, pok := positiveInt(v); pok {
				cfg.TrashRetentionDays = n
			}
		case KeyChangeLogKeep:
			if n, pok := positiveInt(v); pok {
				cfg.ChangeLogKeep = n
			}
		case KeyThumbnailSize:
			if n, pok := positiveInt(v); pok {
				cfg.ThumbnailSize = n
			}
		case KeyOCREnabled:
			if b, pok := parseStoredBool(v); pok {
				cfg.OCREnabled = b
			}
		case KeyBackupDir:
			cfg.BackupDir = strings.TrimSpace(v)
		case KeyBackupIntervalHours:
			if n, pok := positiveInt(v); pok {
				cfg.BackupIntervalHours = n
			}
		case KeyBackupKeep:
			if n, pok := positiveInt(v); pok {
				cfg.BackupKeep = n
			}
		case KeyMetricsToken:
			cfg.MetricsToken = v
		case KeyAndroidAPK:
			cfg.AndroidAPK = strings.TrimSpace(v)
		}
	}
	return cfg
}

// parseStoredBool parses a server_settings boolean value ("1"/"0", to match
// what ValidateSetting canonicalizes to). Unlike boolEnv, it reports whether
// the string was recognised at all, so an unrecognised stored value is
// ignored rather than silently treated as false.
func parseStoredBool(s string) (value, ok bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

// ValidateSetting checks a raw incoming PATCH value against key's descriptor
// and returns the canonical string to store (or an error naming what's
// wrong, suitable for the PATCH response's per-key "error" field). It never
// touches the filesystem or the database — the backup_dir existence/
// writability check is httpapi's job, layered on top of this.
func ValidateSetting(key SettingKey, raw string) (string, error) {
	d, ok := CatalogKey(string(key))
	if !ok {
		return "", fmt.Errorf("unknown setting")
	}
	switch d.Type {
	case TypeInt:
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil {
			return "", fmt.Errorf("must be a whole number")
		}
		if d.Min > 0 && n < d.Min {
			return "", fmt.Errorf("must be at least %d", d.Min)
		}
		if d.Max > 0 && n > d.Max {
			return "", fmt.Errorf("must be at most %d", d.Max)
		}
		return strconv.Itoa(n), nil
	case TypeBool:
		b, pok := parseStoredBool(raw)
		if !pok {
			return "", fmt.Errorf("must be true or false")
		}
		if b {
			return "1", nil
		}
		return "0", nil
	case TypeString:
		if d.Secret && len(raw) > 256 {
			return "", fmt.Errorf("must be at most 256 characters")
		}
		return raw, nil
	case TypePath:
		return strings.TrimSpace(raw), nil
	default:
		return "", fmt.Errorf("unknown setting")
	}
}

// FieldString stringifies cfg's field for key, matching the canonical form
// ValidateSetting produces. Used to build a GET /api/settings entry's
// "value" (and, against Default(), its "default").
func FieldString(c Config, key SettingKey) string {
	switch key {
	case KeyTrashRetentionDays:
		return strconv.Itoa(c.TrashRetentionDays)
	case KeyChangeLogKeep:
		return strconv.Itoa(c.ChangeLogKeep)
	case KeyThumbnailSize:
		return strconv.Itoa(c.ThumbnailSize)
	case KeyOCREnabled:
		if c.OCREnabled {
			return "1"
		}
		return "0"
	case KeyBackupDir:
		return c.BackupDir
	case KeyBackupIntervalHours:
		return strconv.Itoa(c.BackupIntervalHours)
	case KeyBackupKeep:
		return strconv.Itoa(c.BackupKeep)
	case KeyMetricsToken:
		return c.MetricsToken
	case KeyAndroidAPK:
		return c.AndroidAPK
	default:
		return ""
	}
}

// RestartPending reports which restart-mode catalog keys differ between the
// currently configured values and the ones the process booted with. Needs no
// stored "pending" state: it is a live diff, computed fresh on every call.
func RestartPending(current, booted Config) []string {
	var pending []string
	for _, d := range Catalog {
		if d.Apply != ApplyRestart {
			continue
		}
		if FieldString(current, d.Key) != FieldString(booted, d.Key) {
			pending = append(pending, string(d.Key))
		}
	}
	sort.Strings(pending)
	return pending
}
