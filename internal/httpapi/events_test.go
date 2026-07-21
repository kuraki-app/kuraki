package httpapi

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
)

func brokerTestDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	return database
}

func logChange(t *testing.T, database *sql.DB, id string) {
	t.Helper()
	if _, err := database.Exec(
		`INSERT INTO change_log (entity, entity_id, op, owner_id) VALUES ('asset', ?, 'update', 'owner1')`, id); err != nil {
		t.Fatal(err)
	}
}

// TestChangeBrokerBroadcastsOnAdvance proves the poller pings a subscriber only
// after change_log advances past the id present when the broker started.
func TestChangeBrokerBroadcastsOnAdvance(t *testing.T) {
	database := brokerTestDB(t)
	logChange(t, database, "pre") // exists before the broker seeds its high-water mark
	b := NewChangeBroker(database, slog.New(slog.NewTextHandler(io.Discard, nil)))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go b.Poll(ctx, 10*time.Millisecond)
	time.Sleep(30 * time.Millisecond) // let Poll seed lastID from the pre-existing row

	ch := b.subscribe()
	defer b.unsubscribe(ch)
	// No new change yet: the subscriber must not be pinged for the seeded row.
	select {
	case <-ch:
		t.Fatal("unexpected wakeup before any new change")
	case <-time.After(40 * time.Millisecond):
	}

	logChange(t, database, "new")
	select {
	case <-ch:
		// expected: poller saw the advance and pinged
	case <-time.After(time.Second):
		t.Fatal("no wakeup after a new change was logged")
	}
}

// TestChangeBrokerNoPingWithoutChange proves a subscriber is not woken just for
// connecting — the client drains once on connect itself, so the broker only
// signals subsequent changes.
func TestChangeBrokerNoPingWithoutChange(t *testing.T) {
	database := brokerTestDB(t)
	logChange(t, database, "pre")
	b := NewChangeBroker(database, slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.lastID = b.currentMax(context.Background())

	ch := b.subscribe()
	defer b.unsubscribe(ch)
	select {
	case <-ch:
		t.Fatal("subscriber pinged on connect with no new change")
	case <-time.After(40 * time.Millisecond):
	}
}

// TestChangeBrokerBroadcastCoalesces proves a full subscriber buffer never
// blocks the broadcaster — the redundant wakeup is dropped, and the subscriber
// still catches everything via its own cursor drain.
func TestChangeBrokerBroadcastCoalesces(t *testing.T) {
	b := NewChangeBroker(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ch := b.subscribe() // buffered (cap 1), currently empty (lastID 0, no prime)
	defer b.unsubscribe(ch)

	done := make(chan struct{})
	go func() {
		b.broadcast(1) // fills the buffer
		b.broadcast(2) // buffer full -> dropped, must not block
		b.broadcast(3)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broadcast blocked on a full subscriber buffer")
	}
	if got := <-ch; got != 1 {
		t.Fatalf("first wakeup = %d, want 1", got)
	}
}
