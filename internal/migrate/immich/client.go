// Package immich reads a live Immich server through its public REST API so its
// library can be migrated into Kuraki.
//
// The API is the only integration point on purpose: Immich's Postgres schema
// changes every release, while the documented endpoints used here are marked
// stable and versioned. Nothing in this package writes to Immich.
package immich

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is a read-only Immich API client.
type Client struct {
	BaseURL string // normalized to end in "/api"
	APIKey  string
	HTTP    *http.Client

	// MaxRetries bounds retries of transient failures (429 and 5xx).
	MaxRetries int
	// RetryBase is the first backoff interval; it doubles per attempt.
	RetryBase time.Duration
}

// NewClient normalizes a user-supplied server URL into an API base. Operators
// paste whatever is in their browser bar, so accept both "https://host" and
// "https://host/api", with or without a trailing slash.
func NewClient(rawURL, apiKey string, httpClient *http.Client) (*Client, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, fmt.Errorf("immich: server url is required")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("immich: parse server url: %w", err)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("immich: server url has no host: %q", rawURL)
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("immich: api key is required")
	}

	path := strings.TrimSuffix(parsed.Path, "/")
	if !strings.HasSuffix(path, "/api") {
		path += "/api"
	}
	parsed.Path = path
	parsed.RawQuery = ""
	parsed.Fragment = ""

	if httpClient == nil {
		// No overall timeout: a single original can be a multi-gigabyte video.
		// Connection-level timeouts below still bound a wedged server.
		httpClient = &http.Client{
			Transport: &http.Transport{
				ResponseHeaderTimeout: 60 * time.Second,
				IdleConnTimeout:       90 * time.Second,
				MaxIdleConnsPerHost:   8,
			},
		}
	}
	return &Client{
		BaseURL:    parsed.String(),
		APIKey:     strings.TrimSpace(apiKey),
		HTTP:       httpClient,
		MaxRetries: 3,
		RetryBase:  time.Second,
	}, nil
}

// AuthError marks credentials that will never work, so callers abort the whole
// run instead of retrying every asset against a rejected key.
type AuthError struct {
	Status int
	Body   string
}

func (e *AuthError) Error() string {
	return fmt.Sprintf("immich: authentication failed (HTTP %d): check the API key and that it has asset.read/download permissions", e.Status)
}

// APIError is any other non-2xx response.
type APIError struct {
	Status int
	Path   string
	Body   string
}

func (e *APIError) Error() string {
	body := e.Body
	if len(body) > 300 {
		body = body[:300] + "…"
	}
	return fmt.Sprintf("immich: %s: HTTP %d: %s", e.Path, e.Status, body)
}

func (c *Client) retries() int {
	if c.MaxRetries > 0 {
		return c.MaxRetries
	}
	return 3
}

func (c *Client) retryBase() time.Duration {
	if c.RetryBase > 0 {
		return c.RetryBase
	}
	return time.Second
}

// do issues one request with retries on transient failures. handle consumes the
// response body; it is called at most once per successful attempt.
func (c *Client) do(ctx context.Context, method, path string, body []byte, handle func(*http.Response) error) error {
	var lastErr error
	for attempt := 0; ; attempt++ {
		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
		if err != nil {
			return fmt.Errorf("immich: build request: %w", err)
		}
		req.Header.Set("x-api-key", c.APIKey)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := c.HTTP.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("immich: %s %s: %w", method, path, err)
		} else {
			switch {
			case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
				snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
				resp.Body.Close()
				return &AuthError{Status: resp.StatusCode, Body: string(snippet)}
			case resp.StatusCode >= 200 && resp.StatusCode < 300:
				err := handle(resp)
				resp.Body.Close()
				return err
			case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
				snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
				resp.Body.Close()
				lastErr = &APIError{Status: resp.StatusCode, Path: path, Body: string(snippet)}
			default:
				snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
				resp.Body.Close()
				return &APIError{Status: resp.StatusCode, Path: path, Body: string(snippet)}
			}
		}

		if attempt >= c.retries() {
			return lastErr
		}
		wait := c.retryBase() << attempt
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, func(resp *http.Response) error {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("immich: decode %s: %w", path, err)
		}
		return nil
	})
}

func (c *Client) postJSON(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("immich: encode %s body: %w", path, err)
	}
	return c.do(ctx, http.MethodPost, path, body, func(resp *http.Response) error {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("immich: decode %s: %w", path, err)
		}
		return nil
	})
}

// --- wire types (subset of Immich's OpenAPI schemas we consume) ---

type serverVersion struct {
	Major int `json:"major"`
	Minor int `json:"minor"`
	Patch int `json:"patch"`
}

func (v serverVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

type serverStatistics struct {
	Photos int `json:"photos"`
	Videos int `json:"videos"`
}

type exifInfo struct {
	Make             string   `json:"make"`
	Model            string   `json:"model"`
	Description      string   `json:"description"`
	DateTimeOriginal *string  `json:"dateTimeOriginal"`
	Latitude         *float64 `json:"latitude"`
	Longitude        *float64 `json:"longitude"`
	Rating           *int     `json:"rating"`
}

type tagDTO struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	ParentID string `json:"parentId"`
}

// stackDetailDTO is what GET /stacks returns: the stack plus its members.
type stackDetailDTO struct {
	ID             string `json:"id"`
	PrimaryAssetID string `json:"primaryAssetId"`
	Assets         []struct {
		ID string `json:"id"`
	} `json:"assets"`
}

type assetDTO struct {
	ID               string    `json:"id"`
	Type             string    `json:"type"`
	OriginalFileName string    `json:"originalFileName"`
	FileCreatedAt    string    `json:"fileCreatedAt"`
	LocalDateTime    string    `json:"localDateTime"`
	IsFavorite       bool      `json:"isFavorite"`
	IsTrashed        bool      `json:"isTrashed"`
	IsOffline        bool      `json:"isOffline"`
	Visibility       string    `json:"visibility"`
	Duration         string    `json:"duration"`
	LivePhotoVideoID string    `json:"livePhotoVideoId"`
	ExifInfo         *exifInfo `json:"exifInfo"`

	// Deliberately absent: "tags" and "stack". Search responses leave both null
	// — only GET /assets/{id} hydrates them — so declaring them here would
	// invite reading a field that is always empty on this code path. Both are
	// resolved from the list endpoints instead (see Source's indexes).
}

type albumDTO struct {
	ID          string `json:"id"`
	AlbumName   string `json:"albumName"`
	Description string `json:"description"`
	AssetCount  int    `json:"assetCount"`
}

type searchResponse struct {
	Assets struct {
		Items    []assetDTO `json:"items"`
		NextPage *string    `json:"nextPage"`
		Total    int        `json:"total"`
		Count    int        `json:"count"`
	} `json:"assets"`
}

// metadataSearch is the request body for POST /search/metadata.
type metadataSearch struct {
	Page        int      `json:"page"`
	Size        int      `json:"size"`
	WithExif    bool     `json:"withExif"`
	WithDeleted bool     `json:"withDeleted"`
	WithStacked bool     `json:"withStacked"`
	Order       string   `json:"order"`
	AlbumIDs    []string `json:"albumIds,omitempty"`
	TagIDs      []string `json:"tagIds,omitempty"`
	TakenAfter  string   `json:"takenAfter,omitempty"`
	Visibility  string   `json:"visibility,omitempty"`
}

// --- API calls ---

// Version returns the Immich server version string.
func (c *Client) Version(ctx context.Context) (string, error) {
	var v serverVersion
	if err := c.getJSON(ctx, "/server/version", &v); err != nil {
		return "", err
	}
	return v.String(), nil
}

// Statistics returns the total asset count (photos + videos).
func (c *Client) Statistics(ctx context.Context) (int, error) {
	var s serverStatistics
	if err := c.getJSON(ctx, "/server/statistics", &s); err != nil {
		// Server statistics require admin rights on some deployments; a
		// non-admin key should still be able to migrate its own library, so a
		// missing total is not fatal — it only costs a progress denominator.
		var apiErr *APIError
		if ok := asAPIError(err, &apiErr); ok && apiErr.Status == http.StatusForbidden {
			return 0, nil
		}
		return 0, err
	}
	return s.Photos + s.Videos, nil
}

// Albums lists every album owned by the key's user.
func (c *Client) Albums(ctx context.Context) ([]albumDTO, error) {
	var albums []albumDTO
	if err := c.getJSON(ctx, "/albums", &albums); err != nil {
		return nil, err
	}
	return albums, nil
}

// AlbumAssetIDs returns the asset IDs in one album. Album membership is not
// carried on the asset payload, so it is collected per album and inverted.
func (c *Client) AlbumAssetIDs(ctx context.Context, albumID string) ([]string, error) {
	return c.searchIDs(ctx, func(m *metadataSearch) { m.AlbumIDs = []string{albumID} })
}

// TagAssetIDs returns the asset IDs carrying one tag.
//
// Search results do not hydrate an asset's tags — only GET /assets/{id} does —
// so tags are inverted per tag instead, which costs one request per tag rather
// than one per asset.
func (c *Client) TagAssetIDs(ctx context.Context, tagID string) ([]string, error) {
	return c.searchIDs(ctx, func(m *metadataSearch) { m.TagIDs = []string{tagID} })
}

// searchIDs pages a filtered metadata search and collects asset IDs.
func (c *Client) searchIDs(ctx context.Context, filter func(*metadataSearch)) ([]string, error) {
	ids := make([]string, 0)
	for page := 1; ; page++ {
		body := metadataSearch{
			Page: page, Size: searchPageSize, Order: "asc",
			WithDeleted: true, WithStacked: true,
		}
		filter(&body)
		var resp searchResponse
		if err := c.postJSON(ctx, "/search/metadata", body, &resp); err != nil {
			return nil, err
		}
		for _, a := range resp.Assets.Items {
			ids = append(ids, a.ID)
		}
		if resp.Assets.NextPage == nil || *resp.Assets.NextPage == "" {
			return ids, nil
		}
	}
}

// Stacks lists every stack with its members. Like tags, an asset's stack is not
// hydrated in search results, so it is fetched here and inverted.
func (c *Client) Stacks(ctx context.Context) ([]stackDetailDTO, error) {
	var stacks []stackDetailDTO
	if err := c.getJSON(ctx, "/stacks", &stacks); err != nil {
		return nil, err
	}
	return stacks, nil
}

// Tags lists every tag owned by the key's user.
func (c *Client) Tags(ctx context.Context) ([]tagDTO, error) {
	var tags []tagDTO
	if err := c.getJSON(ctx, "/tags", &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

const searchPageSize = 250

// SearchPage fetches one page of assets. page is 1-based.
//
// withStacked is always true, and is not tied to whether the caller wants stacks
// preserved: with it false Immich omits *every* member of a stack from the
// results, primary included. Leaving it off would silently drop those assets
// from the migration entirely.
func (c *Client) SearchPage(ctx context.Context, page int, opts SearchOptions) (searchResponse, error) {
	var resp searchResponse
	body := metadataSearch{
		Page:        page,
		Size:        searchPageSize,
		WithExif:    true,
		WithStacked: true,
		WithDeleted: opts.IncludeTrashed,
		Order:       "asc",
		TakenAfter:  opts.TakenAfter,
	}
	if err := c.postJSON(ctx, "/search/metadata", body, &resp); err != nil {
		return searchResponse{}, err
	}
	return resp, nil
}

// SearchOptions narrows which assets a migration walks.
type SearchOptions struct {
	IncludeTrashed bool
	TakenAfter     string // RFC3339; empty means no lower bound
}

// Download streams an asset's original bytes. The unedited original is
// requested deliberately: Kuraki's originals are write-once, so it stores what
// the camera produced rather than Immich's edit of it.
func (c *Client) Download(ctx context.Context, assetID string, dst io.Writer) error {
	return c.do(ctx, http.MethodGet, "/assets/"+url.PathEscape(assetID)+"/original", nil,
		func(resp *http.Response) error {
			if _, err := io.Copy(dst, resp.Body); err != nil {
				return fmt.Errorf("immich: download %s: %w", assetID, err)
			}
			return nil
		})
}

// asAPIError is a tiny errors.As shim kept local so callers do not need to
// import errors just to branch on status.
func asAPIError(err error, target **APIError) bool {
	if e, ok := err.(*APIError); ok {
		*target = e
		return true
	}
	return false
}
