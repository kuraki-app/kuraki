package maintenance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kuraki-app/kuraki/internal/verify"
)

var ErrBusy = errors.New("maintenance queue unavailable or full")

type manualWork struct {
	key string
	run func(context.Context) error
}

func (m *Manager) startManual(ctx context.Context) {
	m.manualMu.Lock()
	defer m.manualMu.Unlock()
	if m.manualCtx != nil {
		return
	}
	m.manualCtx = ctx
	for range 2 {
		m.manualWG.Add(1)
		go func() {
			defer m.manualWG.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case work := <-m.manualQueue:
					m.runManual(ctx, work)
				}
			}
		}()
	}
}

// Schedule bounds media processes, temporary copies and full-library scans.
// Repeated keys coalesce; application cancellation owns the worker lifetime.
func (m *Manager) Schedule(key string, run func(context.Context) error) error {
	m.manualMu.Lock()
	defer m.manualMu.Unlock()
	if m.manualCtx == nil || m.manualCtx.Err() != nil {
		return ErrBusy
	}
	if m.manualKeys[key] {
		return nil
	}
	m.manualKeys[key] = true
	select {
	case m.manualQueue <- manualWork{key: key, run: run}:
		return nil
	default:
		delete(m.manualKeys, key)
		return ErrBusy
	}
}

func (m *Manager) runManual(parent context.Context, work manualWork) {
	defer func() {
		if cause := recover(); cause != nil {
			m.log.Error("maintenance panic contained", "operation", work.key, "cause", fmt.Sprint(cause))
		}
		m.manualMu.Lock()
		delete(m.manualKeys, work.key)
		m.manualMu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(parent, 15*time.Minute)
	defer cancel()
	if ctx.Err() != nil {
		return
	}
	if err := work.run(ctx); err != nil {
		m.log.Warn("maintenance operation failed", "operation", work.key, "err", err)
	}
}

func (m *Manager) ScheduleIntegrity() error {
	return m.Schedule("integrity", func(ctx context.Context) error {
		result, err := verify.RunAndRecord(ctx, m.db, m.store)
		if err == nil {
			m.log.Info("integrity verification complete", "checked", result.Checked, "problems", len(result.Problems))
		}
		return err
	})
}

func (m *Manager) Wait() { m.manualWG.Wait() }
