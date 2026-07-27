// Package migrate moves a photo library from another server into Kuraki,
// preserving the metadata that does not live in the media bytes: capture times,
// locations, captions, favorites, ratings, archive state, albums, tags, stacks,
// and trash.
//
// The engine here is source-agnostic. A source (internal/migrate/immich today,
// a Google Takeout reader later) only has to enumerate items, hand over their
// metadata, and stream original bytes on request; everything about batching,
// resume, importing, and wiring up relations lives in this package.
package migrate

import (
	"context"
	"io"

	"github.com/kuraki-app/kuraki/internal/domain"
)

// Source is a read-only view of a foreign photo library.
//
// Implementations must be safe for concurrent Fetch calls — the engine
// downloads a batch in parallel — but the engine never calls Assets
// concurrently with itself.
type Source interface {
	// Name identifies the source in migration_map, e.g. "immich".
	Name() string

	// Probe checks reachability and credentials before any work starts.
	Probe(ctx context.Context) (Info, error)

	// Albums and Tags enumerate the containers, which the engine creates
	// locally before importing any asset so membership can be wired up as each
	// batch lands.
	Albums(ctx context.Context) ([]Album, error)
	Tags(ctx context.Context) ([]Tag, error)

	// Assets returns one page of items. An empty cursor starts from the
	// beginning; an empty NextCursor in the returned page ends the walk.
	Assets(ctx context.Context, cursor string) (Page, error)

	// Fetch streams one item's original bytes.
	Fetch(ctx context.Context, item Item, dst io.Writer) error

	// Close releases any resources the source holds.
	Close() error
}

// Info is what a Probe learned about the source server.
type Info struct {
	Version     string
	TotalAssets int
	Endpoint    string
}

// Item is one media file in the source library.
type Item struct {
	SourceID string
	Filename string
	Meta     domain.ExternalMetadata

	AlbumIDs []string // source album IDs this item belongs to
	TagIDs   []string // source tag IDs applied to this item

	// StackID groups related captures (RAW+JPEG, Live Photo pairs). Empty when
	// the item is not stacked.
	StackID      string
	StackPrimary bool

	// Trashed items are imported and then soft-deleted, so they land in
	// Kuraki's trash rather than vanishing.
	Trashed bool

	// Skip marks an item the source knows Kuraki cannot store (audio, "other",
	// locked assets). The engine records it as skipped with SkipReason rather
	// than attempting a download.
	Skip       bool
	SkipReason string
}

// Page is one page of Assets results.
type Page struct {
	Items      []Item
	NextCursor string
}

// Album is a source album. Assets carry their own AlbumIDs, so an album needs
// no member list here.
type Album struct {
	SourceID    string
	Name        string
	Description string
}

// Tag is a source tag. ParentSourceID is empty for a root tag; both Immich and
// Kuraki support nesting.
type Tag struct {
	SourceID       string
	Name           string
	ParentSourceID string
}
