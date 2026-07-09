package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipLimiter is a per-client-IP token-bucket rate limiter used to throttle
// sensitive endpoints like login (F-14). Entries are evicted after ttl of
// inactivity so the map cannot grow unbounded.
type ipLimiter struct {
	mu      sync.Mutex
	clients map[string]*limiterEntry
	rate    rate.Limit
	burst   int
	ttl     time.Duration
}

type limiterEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

func newIPLimiter(r rate.Limit, burst int, ttl time.Duration) *ipLimiter {
	return &ipLimiter{clients: make(map[string]*limiterEntry), rate: r, burst: burst, ttl: ttl}
}

func (l *ipLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	e, ok := l.clients[key]
	if !ok {
		e = &limiterEntry{lim: rate.NewLimiter(l.rate, l.burst)}
		l.clients[key] = e
	}
	e.seen = now
	if len(l.clients) > 1024 { // opportunistic eviction of stale entries
		for k, v := range l.clients {
			if now.Sub(v.seen) > l.ttl {
				delete(l.clients, k)
			}
		}
	}
	return e.lim.Allow()
}

func (l *ipLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the client address. chi's RealIP middleware has already
// normalized RemoteAddr from X-Forwarded-For / X-Real-IP when present.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
