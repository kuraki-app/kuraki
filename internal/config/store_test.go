package config

import "testing"

func TestStoreRefreshUpdatesCurrentNotBooted(t *testing.T) {
	base := Default()
	s := NewStore(base, map[string]bool{}, map[string]string{})

	if s.Current().TrashRetentionDays != base.TrashRetentionDays {
		t.Fatal("a fresh Store's Current() must equal the booted config")
	}

	s.Refresh(map[string]string{string(KeyTrashRetentionDays): "14"})
	if got := s.Current().TrashRetentionDays; got != 14 {
		t.Fatalf("Current() after Refresh = %d, want 14", got)
	}
	if got := s.Booted().TrashRetentionDays; got != base.TrashRetentionDays {
		t.Fatalf("Booted() must stay frozen at the boot value, got %d", got)
	}
}

func TestStoreRefreshHonoursPinning(t *testing.T) {
	base := Default()
	pinned := map[string]bool{"KURAKI_THUMBNAIL_SIZE": true}
	s := NewStore(base, pinned, map[string]string{})

	s.Refresh(map[string]string{string(KeyThumbnailSize): "2048"})
	if got := s.Current().ThumbnailSize; got != base.ThumbnailSize {
		t.Fatalf("a pinned key must not change on Refresh: got %d, want %d", got, base.ThumbnailSize)
	}
}
