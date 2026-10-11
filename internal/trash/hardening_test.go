package trash

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/storage"
)

type gatedPurgeStorage struct {
	storage.Storage
	ready, resume chan struct{}
	gated         atomic.Bool
}

func (s *gatedPurgeStorage) LockLibrary(ctx context.Context, exclusive bool) (func() error, error) {
	if exclusive && s.gated.CompareAndSwap(false, true) {
		close(s.ready)
		<-s.resume
	}
	return storage.LockLibrary(ctx, s.Storage, exclusive)
}

func TestRestoreInvalidatesAnAlreadyListedRetentionCandidate(t *testing.T) {
	ctx, database, store := setup(t)
	addAsset(t, ctx, database, store, "race", "2026/07/race.jpg")
	if err := Delete(ctx, database, store, "race"); err != nil {
		t.Fatal(err)
	}
	gated := &gatedPurgeStorage{Storage: store, ready: make(chan struct{}), resume: make(chan struct{})}
	type outcome struct {
		n   int
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		n, err := PurgeExpired(ctx, database, gated, time.Now().Add(time.Hour))
		done <- outcome{n, err}
	}()
	select {
	case <-gated.ready:
	case <-time.After(5 * time.Second):
		t.Fatal("retention did not list the candidate")
	}
	err := Restore(ctx, database, store, "race")
	close(gated.resume)
	if err != nil {
		t.Fatal(err)
	}
	result := <-done
	if result.err != nil || result.n != 0 {
		t.Fatalf("restored candidate purged: %+v", result)
	}
	if !exists(t, ctx, store, "originals/2026/07/race.jpg") || !exists(t, ctx, store, "derivatives/race/thumb.jpg") {
		t.Fatal("restored data was removed")
	}
}

type failedRemovalStore struct{ storage.Storage }

func (s failedRemovalStore) LockLibrary(ctx context.Context, exclusive bool) (func() error, error) {
	return storage.LockLibrary(ctx, s.Storage, exclusive)
}
func (s failedRemovalStore) Remove(ctx context.Context, path string) error {
	if strings.HasPrefix(path, "originals/") {
		return errors.New("disk unavailable")
	}
	return s.Storage.Remove(ctx, path)
}

func TestPurgeCleanupCanResumeAfterStorageFailure(t *testing.T) {
	ctx, database, store := setup(t)
	addAsset(t, ctx, database, store, "cleanup", "2026/07/cleanup.jpg")
	if err := Delete(ctx, database, store, "cleanup"); err != nil {
		t.Fatal(err)
	}
	if err := Purge(ctx, database, failedRemovalStore{store}, "cleanup"); err == nil {
		t.Fatal("storage failure was hidden")
	}
	var pending int
	if err := database.QueryRow(`SELECT COUNT(*) FROM storage_cleanup`).Scan(&pending); err != nil || pending == 0 {
		t.Fatalf("cleanup intent missing: %d %v", pending, err)
	}
	if err := Reconcile(ctx, database, store); err != nil {
		t.Fatal(err)
	}
	if exists(t, ctx, store, "originals/2026/07/cleanup.jpg") {
		t.Fatal("committed cleanup was not resumed")
	}
	if err := database.QueryRow(`SELECT COUNT(*) FROM storage_cleanup`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("cleanup intents=%d err=%v", pending, err)
	}
}

func TestReconcileRecoversInterruptedLegacyMoves(t *testing.T) {
	ctx, database, store := setup(t)
	addAsset(t, ctx, database, store, "legacy", "2026/07/legacy.jpg")
	if err := store.Move(ctx, "originals/2026/07/legacy.jpg", "trash/2026/07/legacy.jpg"); err != nil {
		t.Fatal(err)
	}
	if err := Reconcile(ctx, database, store); err != nil {
		t.Fatal(err)
	}
	if !exists(t, ctx, store, "originals/2026/07/legacy.jpg") {
		t.Fatal("active original was not recovered")
	}
	if err := Delete(ctx, database, store, "legacy"); err != nil {
		t.Fatal(err)
	}
	if err := Reconcile(ctx, database, store); err != nil {
		t.Fatal(err)
	}
	if err := Restore(ctx, database, store, "legacy"); err != nil {
		t.Fatalf("reconciliation changed trash state: %v", err)
	}
}
