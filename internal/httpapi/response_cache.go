package httpapi

import (
	"container/list"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

const (
	readCacheTTL      = 5 * time.Second
	readCacheEntries  = 256
	readCacheBytes    = 8 << 20
	maxCachedResponse = 256 << 10
)

// responseCache is a bounded, process-local cache for small owner-scoped JSON
// reads. Its interface is deliberately the middleware below: callers never
// choose keys, retain entries, or reason about eviction. Writes invalidate the
// whole small cache so correctness stays local even as new mutation routes land.
type responseCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	maxKeys int
	maxSize int
	now     func() time.Time
	entries map[string]*list.Element
	order   *list.List
	bytes   int
	hits    uint64
	misses  uint64
}

type cachedResponse struct {
	key         string
	body        []byte
	contentType string
	storedAt    time.Time
}

type responseCacheStats struct {
	Hits    uint64 `json:"hits"`
	Misses  uint64 `json:"misses"`
	Entries int    `json:"entries"`
	Bytes   int    `json:"bytes"`
}

func newResponseCache(ttl time.Duration, maxKeys, maxSize int) *responseCache {
	return &responseCache{
		ttl: ttl, maxKeys: maxKeys, maxSize: maxSize, now: time.Now,
		entries: make(map[string]*list.Element), order: list.New(),
	}
}

func (c *responseCache) get(key string) (cachedResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[key]
	if !ok {
		c.misses++
		return cachedResponse{}, false
	}
	entry := element.Value.(cachedResponse)
	if c.now().Sub(entry.storedAt) >= c.ttl {
		c.remove(element)
		c.misses++
		return cachedResponse{}, false
	}
	c.order.MoveToFront(element)
	c.hits++
	entry.body = append([]byte(nil), entry.body...)
	return entry, true
}

func (c *responseCache) put(key string, body []byte, contentType string) {
	if len(body) == 0 || len(body) > maxCachedResponse || len(body) > c.maxSize {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.entries[key]; ok {
		c.remove(existing)
	}
	for c.order.Len() > 0 && (c.order.Len() >= c.maxKeys || c.bytes+len(body) > c.maxSize) {
		c.remove(c.order.Back())
	}
	entry := cachedResponse{
		key: key, body: append([]byte(nil), body...), contentType: contentType, storedAt: c.now(),
	}
	c.entries[key] = c.order.PushFront(entry)
	c.bytes += len(entry.body)
}

func (c *responseCache) invalidate() {
	c.mu.Lock()
	c.entries = make(map[string]*list.Element)
	c.order.Init()
	c.bytes = 0
	c.mu.Unlock()
}

func (c *responseCache) stats() responseCacheStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return responseCacheStats{Hits: c.hits, Misses: c.misses, Entries: c.order.Len(), Bytes: c.bytes}
}

func (c *responseCache) remove(element *list.Element) {
	entry := element.Value.(cachedResponse)
	delete(c.entries, entry.key)
	c.bytes -= len(entry.body)
	c.order.Remove(element)
}

func cacheableReadPath(path string) bool {
	switch path {
	case "/api/assets", "/api/search", "/api/favorites", "/api/memories", "/api/trash",
		"/api/places", "/api/places/summary", "/api/places/map", "/api/stats", "/api/tags",
		"/api/saved-searches", "/api/albums":
		return true
	}
	return strings.HasPrefix(path, "/api/albums/")
}

func (d Deps) cacheRead(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !cacheableReadPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		owner, ok := d.ownerID(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		// change_log is the library's mutation ledger. Including its owner-scoped
		// high-water mark means importer/background changes bypass old entries on
		// the next request, without coupling this module to every writer.
		version, err := d.readCacheVersion(r, owner)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		key := owner + "\x00" + version + "\x00" + r.URL.EscapedPath() + "?" + r.URL.RawQuery
		if cached, ok := d.responses.get(key); ok {
			w.Header().Set("Content-Type", cached.contentType)
			w.Header().Set("X-Kuraki-Cache", "hit")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(cached.body)
			return
		}

		recorder := httptest.NewRecorder()
		next.ServeHTTP(recorder, r)
		for header, values := range recorder.Header() {
			w.Header()[header] = append([]string(nil), values...)
		}
		w.Header().Set("X-Kuraki-Cache", "miss")
		w.WriteHeader(recorder.Code)
		_, _ = w.Write(recorder.Body.Bytes())
		if recorder.Code == http.StatusOK && strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
			d.responses.put(key, recorder.Body.Bytes(), recorder.Header().Get("Content-Type"))
		}
	})
}

func (d Deps) readCacheVersion(r *http.Request, owner string) (string, error) {
	var version int64
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT COALESCE(MAX(id), 0) FROM change_log WHERE owner_id = ?`, owner).Scan(&version); err != nil {
		return "", fmt.Errorf("response cache: read change version: %w", err)
	}
	return strconv.FormatInt(version, 10), nil
}

func (d Deps) invalidateCachedReads(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)
		if r.Method != http.MethodGet && r.Method != http.MethodHead &&
			wrapped.Status() >= http.StatusOK && wrapped.Status() < http.StatusMultipleChoices {
			d.responses.invalidate()
		}
	})
}
