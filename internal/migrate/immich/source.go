package immich

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/kuraki-app/kuraki/internal/domain"
	"github.com/kuraki-app/kuraki/internal/migrate"
)

// Source adapts an Immich server to migrate.Source.
type Source struct {
	client *Client
	opts   Options

	// Immich's search results carry an asset's scalar fields but do not hydrate
	// its albums, tags, or stack — only GET /assets/{id} does, which would mean
	// one extra request per asset. These indexes invert the relationship from
	// the list endpoints instead: one request per album, per tag, and one for
	// all stacks.
	albumsByAsset map[string][]string
	tagsByAsset   map[string][]string
	stacksByAsset map[string]stackMembership

	stacksLoaded bool
}

// stackMembership is the stack an asset belongs to, as Immich states it.
type stackMembership struct {
	StackID string
	Primary bool
}

// Options configures which parts of the Immich library are walked.
type Options struct {
	IncludeTrashed bool
	IncludeAlbums  bool
	IncludeTags    bool
	IncludeStacks  bool
	// TakenAfter limits the walk to assets captured at or after this time,
	// for topping up a library that was migrated once already.
	TakenAfter string
}

// New builds a Source against an Immich server.
func New(rawURL, apiKey string, httpClient *http.Client, opts Options) (*Source, error) {
	c, err := NewClient(rawURL, apiKey, httpClient)
	if err != nil {
		return nil, err
	}
	return &Source{
		client:        c,
		opts:          opts,
		albumsByAsset: make(map[string][]string),
		tagsByAsset:   make(map[string][]string),
		stacksByAsset: make(map[string]stackMembership),
	}, nil
}

// Name identifies this source in migration_map.
func (s *Source) Name() string { return "immich" }

// Close releases idle connections.
func (s *Source) Close() error {
	if t, ok := s.client.HTTP.Transport.(*http.Transport); ok {
		t.CloseIdleConnections()
	}
	return nil
}

// Probe verifies the server is reachable and the key is accepted.
func (s *Source) Probe(ctx context.Context) (migrate.Info, error) {
	version, err := s.client.Version(ctx)
	if err != nil {
		return migrate.Info{}, err
	}
	total, err := s.client.Statistics(ctx)
	if err != nil {
		return migrate.Info{}, err
	}
	return migrate.Info{Version: version, TotalAssets: total, Endpoint: s.client.BaseURL}, nil
}

// Albums lists albums and, as a side effect, builds the asset -> albums index
// the per-item walk needs. Immich exposes membership only per album, so this is
// one extra paged query per album, done once up front.
func (s *Source) Albums(ctx context.Context) ([]migrate.Album, error) {
	if !s.opts.IncludeAlbums {
		return nil, nil
	}
	albums, err := s.client.Albums(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]migrate.Album, 0, len(albums))
	for _, a := range albums {
		out = append(out, migrate.Album{
			SourceID:    a.ID,
			Name:        a.AlbumName,
			Description: a.Description,
		})
		ids, err := s.client.AlbumAssetIDs(ctx, a.ID)
		if err != nil {
			return nil, fmt.Errorf("immich: album %q members: %w", a.AlbumName, err)
		}
		for _, id := range ids {
			s.albumsByAsset[id] = append(s.albumsByAsset[id], a.ID)
		}
	}
	return out, nil
}

// Tags lists tags, preserving Immich's hierarchy.
func (s *Source) Tags(ctx context.Context) ([]migrate.Tag, error) {
	if !s.opts.IncludeTags {
		return nil, nil
	}
	tags, err := s.client.Tags(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]migrate.Tag, 0, len(tags))
	for _, t := range tags {
		// "value" is the full path ("Travel/Japan"); "name" is the leaf. Kuraki
		// nests tags the same way, so the leaf plus a parent link is right.
		name := t.Name
		if name == "" {
			name = t.Value
		}
		out = append(out, migrate.Tag{
			SourceID:       t.ID,
			Name:           name,
			ParentSourceID: t.ParentID,
		})

		ids, err := s.client.TagAssetIDs(ctx, t.ID)
		if err != nil {
			return nil, fmt.Errorf("immich: tag %q members: %w", name, err)
		}
		for _, id := range ids {
			s.tagsByAsset[id] = append(s.tagsByAsset[id], t.ID)
		}
	}
	return out, nil
}

// ensureStacks loads every stack once, on the first page of assets.
func (s *Source) ensureStacks(ctx context.Context) error {
	if s.stacksLoaded || !s.opts.IncludeStacks {
		return nil
	}
	stacks, err := s.client.Stacks(ctx)
	if err != nil {
		return fmt.Errorf("immich: list stacks: %w", err)
	}
	for _, st := range stacks {
		for _, member := range st.Assets {
			s.stacksByAsset[member.ID] = stackMembership{
				StackID: st.ID,
				Primary: member.ID == st.PrimaryAssetID,
			}
		}
	}
	s.stacksLoaded = true
	return nil
}

// Assets returns one page. The cursor is the 1-based page number.
func (s *Source) Assets(ctx context.Context, cursor string) (migrate.Page, error) {
	page := 1
	if cursor != "" {
		n, err := strconv.Atoi(cursor)
		if err != nil {
			return migrate.Page{}, fmt.Errorf("immich: bad cursor %q: %w", cursor, err)
		}
		page = n
	}
	if err := s.ensureStacks(ctx); err != nil {
		return migrate.Page{}, err
	}

	resp, err := s.client.SearchPage(ctx, page, SearchOptions{
		IncludeTrashed: s.opts.IncludeTrashed,
		TakenAfter:     s.opts.TakenAfter,
	})
	if err != nil {
		return migrate.Page{}, err
	}

	items := make([]migrate.Item, 0, len(resp.Assets.Items))
	for _, a := range resp.Assets.Items {
		items = append(items, s.toItem(a))
	}

	next := ""
	if resp.Assets.NextPage != nil && *resp.Assets.NextPage != "" {
		next = *resp.Assets.NextPage
	}
	return migrate.Page{Items: items, NextCursor: next}, nil
}

// toItem maps one Immich asset onto the engine's neutral Item.
func (s *Source) toItem(a assetDTO) migrate.Item {
	item := migrate.Item{
		SourceID: a.ID,
		Filename: a.OriginalFileName,
		Trashed:  a.IsTrashed,
		AlbumIDs: s.albumsByAsset[a.ID],
	}

	switch strings.ToUpper(a.Type) {
	case "IMAGE", "VIDEO":
	default:
		item.Skip = true
		item.SkipReason = fmt.Sprintf("unsupported Immich asset type %q", a.Type)
		return item
	}
	if strings.EqualFold(a.Visibility, "locked") {
		// Locked assets live behind Immich's PIN-protected folder. Kuraki has
		// no equivalent, and silently importing them into the normal timeline
		// would leak them.
		item.Skip = true
		item.SkipReason = "asset is in Immich's locked folder"
		return item
	}
	if a.IsOffline {
		item.Skip = true
		item.SkipReason = "asset is offline in Immich (source file missing)"
		return item
	}

	meta := domain.ExternalMetadata{
		Favorite: a.IsFavorite,
		Archived: strings.EqualFold(a.Visibility, "archive"),
		Hidden:   strings.EqualFold(a.Visibility, "hidden"),
	}
	if a.ExifInfo != nil {
		meta.Description = strings.TrimSpace(a.ExifInfo.Description)
		meta.CameraMake = a.ExifInfo.Make
		meta.CameraModel = a.ExifInfo.Model
		if a.ExifInfo.Rating != nil {
			meta.Rating = *a.ExifInfo.Rating
		}
		// (0,0) is how both systems spell "no location".
		if a.ExifInfo.Latitude != nil && a.ExifInfo.Longitude != nil &&
			(*a.ExifInfo.Latitude != 0 || *a.ExifInfo.Longitude != 0) {
			lat, lon := *a.ExifInfo.Latitude, *a.ExifInfo.Longitude
			meta.Lat, meta.Lon = &lat, &lon
		}
	}
	meta.TakenAt = pickTakenAt(a)
	item.Meta = meta

	if s.opts.IncludeStacks {
		item.StackID, item.StackPrimary = s.stackFor(a)
	}
	item.TagIDs = s.tagsByAsset[a.ID]
	return item
}

// pickTakenAt prefers localDateTime: it is the wall-clock instant of capture,
// which is what Kuraki stores natively from EXIF. dateTimeOriginal is a true
// UTC instant and would shift a photo's day for anyone who travels.
func pickTakenAt(a assetDTO) *time.Time {
	for _, candidate := range []string{a.LocalDateTime, deref(a.ExifInfo), a.FileCreatedAt} {
		if candidate == "" {
			continue
		}
		if t, err := time.Parse(time.RFC3339, candidate); err == nil && !t.IsZero() {
			utc := t.UTC()
			return &utc
		}
	}
	return nil
}

func deref(e *exifInfo) string {
	if e == nil || e.DateTimeOriginal == nil {
		return ""
	}
	return *e.DateTimeOriginal
}

// stackFor derives the stack an asset belongs to.
//
// An explicit Immich stack wins, read from the prefetched index rather than the
// asset payload, which search does not populate. Otherwise a live photo is
// expressed as a stack keyed on the *video's* id — a key both halves of the pair
// compute from their own payload, so the two never depend on page ordering.
// Videos that turn out not to be half of a pair end up alone in their stack, and
// the engine dissolves single-member stacks when it finalizes.
func (s *Source) stackFor(a assetDTO) (string, bool) {
	if m, ok := s.stacksByAsset[a.ID]; ok && m.StackID != "" {
		return "stack:" + m.StackID, m.Primary
	}
	if a.LivePhotoVideoID != "" {
		return "live:" + a.LivePhotoVideoID, true // the still leads the pair
	}
	if strings.EqualFold(a.Type, "VIDEO") {
		return "live:" + a.ID, false
	}
	return "", false
}

// Fetch streams an item's original bytes.
func (s *Source) Fetch(ctx context.Context, item migrate.Item, dst io.Writer) error {
	return s.client.Download(ctx, item.SourceID, dst)
}

// ParseDuration converts Immich's "H:MM:SS.ffffff" duration to milliseconds.
// It is exported for the engine's benefit and returns 0 for anything unparsable,
// since a missing duration must never fail an import.
func ParseDuration(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0
	}
	hours, err1 := strconv.Atoi(parts[0])
	minutes, err2 := strconv.Atoi(parts[1])
	seconds, err3 := strconv.ParseFloat(parts[2], 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return 0
	}
	total := float64(hours*3600+minutes*60)*1000 + seconds*1000
	if total < 0 {
		return 0
	}
	return int64(total)
}
