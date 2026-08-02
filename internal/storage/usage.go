package storage

import "errors"

// ErrUsageUnsupported is returned by Usage on a platform with no filesystem
// statistics call wired up. Callers must treat it as "unknown", never as zero:
// a library reporting 0 bytes free would read as a full disk.
var ErrUsageUnsupported = errors.New("storage: filesystem usage not supported on this platform")

// Usage describes the filesystem holding the data directory.
//
// Free is what the *calling user* may use, which on Unix is smaller than the
// raw free blocks — filesystems reserve a slice for root. Reporting the
// unreserved figure would promise space a non-root Kuraki cannot actually take.
type Usage struct {
	FreeBytes  int64
	TotalBytes int64
}

// UsageReporter is implemented by storage backends that can describe the
// filesystem they sit on.
//
// Deliberately *not* part of Storage. Storage is implemented by test fakes and
// could one day be implemented by an object store, where "free space" is either
// meaningless or an API call with a cost. Keeping this a separate, optional
// interface means a backend that cannot answer simply does not implement it,
// and the handler degrades to omitting the field rather than every fake having
// to grow a method it will never use.
type UsageReporter interface {
	Usage() (Usage, error)
}
