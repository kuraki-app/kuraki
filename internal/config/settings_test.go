package config

import "testing"

func TestEnvPresentIsPresenceNotValue(t *testing.T) {
	getenv := func(k string) string {
		if k == "KURAKI_OCR" {
			return "0"
		}
		return ""
	}
	present := EnvPresent(getenv)
	if !present["KURAKI_OCR"] {
		t.Fatal(`EnvPresent must treat KURAKI_OCR=0 as present, not as unset`)
	}
	if present["KURAKI_THUMBNAIL_SIZE"] {
		t.Fatal("unset variable must not be reported present")
	}
}

func TestPinnedKeysFollowsEnvPresent(t *testing.T) {
	present := map[string]bool{"KURAKI_OCR": true}
	pinned := PinnedKeys(present)
	if len(pinned) != 1 || pinned[0] != string(KeyOCREnabled) {
		t.Fatalf("pinned = %v, want [%s]", pinned, KeyOCREnabled)
	}
}

func TestApplyDBLayersUnderEnv(t *testing.T) {
	base := Default()
	base.TrashRetentionDays = 30 // as if env/flags left it at default

	rows := map[string]string{string(KeyTrashRetentionDays): "14"}
	got := ApplyDB(base, rows, map[string]bool{})
	if got.TrashRetentionDays != 14 {
		t.Fatalf("unpinned DB row must apply: got %d, want 14", got.TrashRetentionDays)
	}

	pinned := map[string]bool{"KURAKI_TRASH_RETENTION_DAYS": true}
	got = ApplyDB(base, rows, pinned)
	if got.TrashRetentionDays != 30 {
		t.Fatalf("env-pinned key must not be overridden by DB: got %d, want 30 (the env/flags value)", got.TrashRetentionDays)
	}
}

func TestApplyDBOCRExplicitFalseFromDB(t *testing.T) {
	base := Default()
	base.OCREnabled = false
	rows := map[string]string{string(KeyOCREnabled): "1"}
	got := ApplyDB(base, rows, map[string]bool{})
	if !got.OCREnabled {
		t.Fatal("DB row '1' must turn OCR on when not pinned")
	}
	rows[string(KeyOCREnabled)] = "0"
	got = ApplyDB(base, rows, map[string]bool{})
	if got.OCREnabled {
		t.Fatal("DB row '0' must turn OCR off when not pinned")
	}
}

func TestApplyDBBackupDirExplicitClear(t *testing.T) {
	base := Default()
	base.BackupDir = "/from/env"
	rows := map[string]string{string(KeyBackupDir): ""}
	got := ApplyDB(base, rows, map[string]bool{})
	if got.BackupDir != "" {
		t.Fatalf("an explicit empty DB row must clear backup_dir, got %q", got.BackupDir)
	}
	// No row at all (never saved) must leave the base value alone.
	got = ApplyDB(base, map[string]string{}, map[string]bool{})
	if got.BackupDir != "/from/env" {
		t.Fatalf("absent row must not clear an existing value, got %q", got.BackupDir)
	}
}

func TestValidateSettingBounds(t *testing.T) {
	if _, err := ValidateSetting(KeyThumbnailSize, "32"); err == nil {
		t.Fatal("32 is below the 64 floor and must be rejected")
	}
	if _, err := ValidateSetting(KeyThumbnailSize, "9000"); err == nil {
		t.Fatal("9000 is above the 4096 ceiling and must be rejected")
	}
	got, err := ValidateSetting(KeyThumbnailSize, "1024")
	if err != nil {
		t.Fatalf("1024 should be valid: %v", err)
	} else if got != "1024" {
		t.Fatalf("canonical value = %q, want 1024", got)
	}
	if _, err := ValidateSetting(KeyChangeLogKeep, "10"); err == nil {
		t.Fatal("10 is far below the 1000 floor and must be rejected")
	}
	if _, err := ValidateSetting(KeyOCREnabled, "yes"); err != nil {
		t.Fatalf("'yes' should parse as a bool: %v", err)
	}
	if _, err := ValidateSetting(KeyOCREnabled, "maybe"); err == nil {
		t.Fatal("'maybe' is not a bool and must be rejected")
	}
}

func TestFieldStringRoundTrip(t *testing.T) {
	c := Default()
	c.ThumbnailSize = 777
	if got := FieldString(c, KeyThumbnailSize); got != "777" {
		t.Fatalf("FieldString = %q, want 777", got)
	}
}

func TestRestartPendingDiffsRestartKeysOnly(t *testing.T) {
	booted := Default()
	current := Default()
	current.ThumbnailSize = 1024    // restart-mode: must show up
	current.TrashRetentionDays = 14 // live-mode: must NOT show up
	pending := RestartPending(current, booted)
	if len(pending) != 1 || pending[0] != string(KeyThumbnailSize) {
		t.Fatalf("pending = %v, want [%s]", pending, KeyThumbnailSize)
	}
}
