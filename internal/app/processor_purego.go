//go:build !vips

package app

import "github.com/kuraki-app/kuraki/internal/media"

// newProcessor returns the CGO-free pure-Go media backend. This is the default
// build. Build with `-tags vips` (M1) to link the libvips backend instead.
func newProcessor() media.Processor { return media.NewPureGo() }
