package config

import "testing"

func TestThumbGenerationSettings(t *testing.T) {
	env := map[string]string{"KURAKI_THUMB_WORKERS": "3", "KURAKI_THUMB_QUEUE": "10"}
	c := Load(func(k string) string { return env[k] })
	if c.ThumbWorkers != 3 || c.ThumbQueue != 10 {
		t.Fatalf("Load = workers %d queue %d, want 3 and 10", c.ThumbWorkers, c.ThumbQueue)
	}
	d := Default()
	if d.ThumbWorkers < 1 || d.ThumbQueue != 64 {
		t.Fatalf("Default = workers %d queue %d, want >=1 and 64", d.ThumbWorkers, d.ThumbQueue)
	}
	for _, key := range []SettingKey{KeyThumbWorkers, KeyThumbQueue} {
		desc, ok := CatalogKey(string(key))
		if !ok || desc.Apply != ApplyRestart {
			t.Fatalf("%s missing from catalog or not restart-applied", key)
		}
		if _, err := ValidateSetting(key, "0"); err == nil {
			t.Fatalf("%s accepted 0", key)
		}
		if got := FieldString(c, key); got == "" {
			t.Fatalf("FieldString(%s) empty", key)
		}
	}
}
