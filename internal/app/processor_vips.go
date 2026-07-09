//go:build vips

package app

import "github.com/kuraki-app/kuraki/internal/media"

// newProcessor returns the libvips-backed media backend for Docker/production
// builds. Plain builds keep using the CGO-free pure-Go backend.
func newProcessor() media.Processor { return media.NewVips() }
