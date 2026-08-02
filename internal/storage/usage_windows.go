//go:build windows

package storage

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// Usage reports the filesystem holding the data directory.
//
// GetDiskFreeSpaceEx rather than GetDiskFreeSpace: the Ex form is the one that
// accounts for per-user disk quotas, so freeToCaller is what this process may
// actually write — the same distinction Bavail draws on unix.
//
// Windows is a supported cross-compile target (see the CI matrix), so this
// exists to stop the feature silently reporting "unknown" on a whole platform.
// It compiles in CI; it has not been run on Windows.
func (f *FS) Usage() (Usage, error) {
	path, err := windows.UTF16PtrFromString(f.Base)
	if err != nil {
		return Usage{}, fmt.Errorf("storage: disk usage %s: %w", f.Base, err)
	}
	var freeToCaller, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(path, &freeToCaller, &total, &free); err != nil {
		return Usage{}, fmt.Errorf("storage: disk usage %s: %w", f.Base, err)
	}
	return Usage{FreeBytes: int64(freeToCaller), TotalBytes: int64(total)}, nil
}
