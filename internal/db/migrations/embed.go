// Package migrations embeds Kuraki's versioned SQL migrations so they travel
// inside the single binary (F-11). goose applies them in filename order.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
