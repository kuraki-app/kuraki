//go:build !unix && !windows

package storage

// Usage is unavailable on this platform.
//
// The build tags above cover every target the CI matrix builds (linux, darwin,
// windows), so this file exists for anything else Go can target — js/wasm,
// plan9 — where reporting a wrong number would be worse than reporting none.
func (f *FS) Usage() (Usage, error) {
	return Usage{}, ErrUsageUnsupported
}
