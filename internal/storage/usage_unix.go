//go:build unix

package storage

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// Usage reports the filesystem holding the data directory.
//
// Pure Go: x/sys/unix issues the syscall directly, so this keeps the package
// CGO-free (invariant 4) and the default build cross-compiling.
//
// Bavail, not Bfree. Bfree counts blocks the *superuser* could still allocate;
// Bavail subtracts the reserved slice ext4 and friends hold back. Kuraki does
// not run as root in the container, so Bfree would promise space it cannot
// actually write into, and "5 GB free" would turn into ENOSPC.
func (f *FS) Usage() (Usage, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(f.Base, &st); err != nil {
		return Usage{}, fmt.Errorf("storage: statfs %s: %w", f.Base, err)
	}
	// Bsize is int64 on Linux and uint32 on Darwin; converting both through
	// uint64 keeps one expression compiling on every unix target.
	bsize := uint64(st.Bsize) //nolint:unconvert // width differs per GOOS
	return Usage{
		FreeBytes:  int64(uint64(st.Bavail) * bsize),
		TotalBytes: int64(uint64(st.Blocks) * bsize),
	}, nil
}
