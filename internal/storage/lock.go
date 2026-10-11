package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const LockFilename = ".kuraki-library.lock"

// LibraryLocker coordinates filesystem snapshots and destructive operations,
// including a CLI backup running alongside the server in another process.
type LibraryLocker interface {
	LockLibrary(context.Context, bool) (func() error, error)
}

func LockLibrary(ctx context.Context, store Storage, exclusive bool) (func() error, error) {
	locker, ok := store.(LibraryLocker)
	if !ok {
		return nil, fmt.Errorf("storage: backend does not support library coordination")
	}
	return locker.LockLibrary(ctx, exclusive)
}

// LockLibrary holds a process-safe shared (snapshot) or exclusive (destructive)
// lock. The operating system releases it automatically after process death.
func (f *FS) LockLibrary(ctx context.Context, exclusive bool) (func() error, error) {
	lock, err := os.OpenFile(filepath.Join(f.Base, LockFilename), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("storage: open library lock: %w", err)
	}
	for {
		if err := ctx.Err(); err != nil {
			lock.Close()
			return nil, err
		}
		acquired, err := tryLibraryLock(lock, exclusive)
		if err != nil {
			lock.Close()
			return nil, fmt.Errorf("storage: lock library: %w", err)
		}
		if acquired {
			return func() error {
				err := releaseLibraryLock(lock)
				closeErr := lock.Close()
				if err != nil {
					return err
				}
				return closeErr
			}, nil
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			lock.Close()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
