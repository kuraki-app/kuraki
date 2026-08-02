package storage_test

import (
	"errors"
	"testing"

	"github.com/kuraki-app/kuraki/internal/storage"
)

// The numbers are the operating system's, so there is nothing here worth
// asserting an exact value against. What is worth pinning is the shape the
// handler relies on: that FS answers at all, that the answer is self-consistent,
// and that "unsupported" is distinguishable from "broken" — because the client
// renders zero as a full disk.
func TestFSUsage(t *testing.T) {
	fs, err := storage.NewFS(t.TempDir())
	if err != nil {
		t.Fatalf("NewFS: %v", err)
	}

	reporter, ok := any(fs).(storage.UsageReporter)
	if !ok {
		t.Fatal("*FS must implement UsageReporter; stats silently omits disk space otherwise")
	}

	usage, err := reporter.Usage()
	if errors.Is(err, storage.ErrUsageUnsupported) {
		t.Skip("no filesystem statistics on this platform")
	}
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}

	if usage.TotalBytes <= 0 {
		t.Errorf("TotalBytes = %d, want > 0", usage.TotalBytes)
	}
	if usage.FreeBytes < 0 {
		t.Errorf("FreeBytes = %d, want >= 0", usage.FreeBytes)
	}
	// Free is what *this* user may claim, so it is at most the whole filesystem
	// and usually less. Exceeding total would mean the reserved-blocks handling
	// is wrong.
	if usage.FreeBytes > usage.TotalBytes {
		t.Errorf("FreeBytes = %d exceeds TotalBytes = %d", usage.FreeBytes, usage.TotalBytes)
	}
}
