package maintenance

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

func TestManualWorkIsBoundedCoalescedAndCancelled(t *testing.T) {
	m := New(nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.startManual(ctx)
	started := make(chan struct{}, 2)
	var active, peak atomic.Int32
	run := func(ctx context.Context) error {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		started <- struct{}{}
		<-ctx.Done()
		active.Add(-1)
		return ctx.Err()
	}
	for _, key := range []string{"first", "second"} {
		if err := m.Schedule(key, run); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("workers did not start")
		}
	}
	for range 100 {
		if err := m.Schedule("first", run); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 32 {
		if err := m.Schedule(fmt.Sprint(i), run); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.Schedule("overflow", run); !errors.Is(err, ErrBusy) {
		t.Fatalf("overflow accepted: %v", err)
	}
	cancel()
	m.Wait()
	if active.Load() != 0 || peak.Load() != 2 {
		t.Fatalf("active=%d peak=%d", active.Load(), peak.Load())
	}
	if err := m.Schedule("after-stop", run); !errors.Is(err, ErrBusy) {
		t.Fatalf("stopped manager accepted work: %v", err)
	}
}
