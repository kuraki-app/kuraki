package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// ChangeBroker turns the polled delta feed into a server-push wakeup. A single
// background goroutine watches change_log's high-water mark; when it advances,
// every connected SSE subscriber is pinged. The ping carries only the new max
// id — clients still drain the owner-scoped /api/changes cursor feed for the
// actual changes, so ordering, owner-scoping and catch-up all stay in one
// place (the feed) and SSE is a pure "drain now" signal that replaces the
// client's poll timer.
//
// One shared poller (not one query per subscriber) means push cost is constant
// in the number of connected clients. Phase-1 is single-owner, so a global
// high-water mark is broadcast to everyone; once multi-user lands this should
// broadcast per owner_id (a spurious wakeup is currently harmless — the drain
// is owner-scoped and just returns empty — but it is needless chatter). See the
// AGENTS.md handoff for the multi-user follow-up.
type ChangeBroker struct {
	db  *sql.DB
	log *slog.Logger

	mu     sync.Mutex
	subs   map[chan int64]struct{}
	lastID int64
}

// NewChangeBroker constructs a broker over db. Poll must be started separately
// (typically as a background worker by the composition root).
func NewChangeBroker(db *sql.DB, log *slog.Logger) *ChangeBroker {
	return &ChangeBroker{db: db, log: log, subs: make(map[chan int64]struct{})}
}

// subscribe registers a subscriber and returns its channel. The channel is
// buffered so a slow reader never blocks the broadcaster: a coalescing send
// (below) means a full buffer just drops the redundant wakeup — the reader will
// still drain from its own cursor and catch everything.
//
// No initial ping is sent on connect: the client always drains once when its
// EventSource opens (see the web sync module), so priming here would be a
// redundant wakeup. The broker's job is purely to signal *subsequent* changes.
func (b *ChangeBroker) subscribe() chan int64 {
	ch := make(chan int64, 1)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *ChangeBroker) unsubscribe(ch chan int64) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
}

// broadcast pings every subscriber with id. The send is non-blocking: if a
// subscriber's buffer is full it already has an un-drained wakeup pending, and
// since the client drains everything past its cursor, one ping stands in for
// any number of coalesced changes.
func (b *ChangeBroker) broadcast(id int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- id:
		default:
		}
	}
}

// Poll watches change_log's max id on the given interval and broadcasts on
// advance. It returns when ctx is cancelled. One row-cheap indexed MAX query
// per tick regardless of subscriber count.
func (b *ChangeBroker) Poll(ctx context.Context, interval time.Duration) {
	// Seed lastID from the current max so a fresh process doesn't broadcast the
	// entire backlog as "new" to the first subscriber.
	b.lastID = b.currentMax(ctx)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			max := b.currentMax(ctx)
			b.mu.Lock()
			advanced := max > b.lastID
			if advanced {
				b.lastID = max
			}
			b.mu.Unlock()
			if advanced {
				b.broadcast(max)
			}
		}
	}
}

func (b *ChangeBroker) currentMax(ctx context.Context) int64 {
	var max sql.NullInt64
	if err := b.db.QueryRowContext(ctx, `SELECT MAX(id) FROM change_log`).Scan(&max); err != nil {
		if b.log != nil {
			b.log.Warn("change broker: max query failed", "err", err)
		}
		return 0
	}
	return max.Int64
}

const sseHeartbeat = 25 * time.Second

// events streams change wakeups to the browser over Server-Sent Events. The
// client opens an EventSource and, on each `change` event, drains /api/changes
// from its persisted cursor — so this replaces the client's poll timer, not the
// feed. Session (cookie) auth only: EventSource cannot send an Authorization
// header, and a device token in the query string would leak into logs, so the
// device surface keeps its foreground-drain instead. On disconnect the browser
// auto-reconnects, and the client's interval poll covers any gap.
// @Summary Change event stream (SSE)
// @Tags    sync
// @Produce text/event-stream
// @Success 200 {string} string "event stream"
// @Failure 401 {object} apitypes.Error
// @Router  /api/events [get]
func (d Deps) events(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.ownerID(r); !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok || d.Events == nil {
		writeError(w, http.StatusInternalServerError, "streaming_unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Defeat proxy buffering (nginx) so events aren't held back.
	w.Header().Set("X-Accel-Buffering", "no")

	// Advise the browser's EventSource on the auto-reconnect backoff.
	fmt.Fprintf(w, "retry: %d\n\n", 5000)
	flusher.Flush()

	ch := d.Events.subscribe()
	defer d.Events.unsubscribe(ch)

	heartbeat := time.NewTicker(sseHeartbeat)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case id := <-ch:
			// Named event so the client listens for `change` specifically; data
			// is the high-water id (informational — the client drains by cursor).
			fmt.Fprintf(w, "event: change\ndata: %d\n\n", id)
			flusher.Flush()
		case <-heartbeat.C:
			// A comment line keeps the connection (and any intermediary) alive
			// without surfacing as an event.
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}
