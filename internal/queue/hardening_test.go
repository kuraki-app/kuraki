package queue

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/storage"
)

type unavailableOriginalStore struct {
	storage.Storage
	cancel context.CancelFunc
}

func (s unavailableOriginalStore) Write(ctx context.Context, path string, r io.Reader) (int64, error) {
	if strings.HasPrefix(path, "originals/") {
		if s.cancel != nil {
			s.cancel()
			return 0, ctx.Err()
		}
		return 0, errors.New("disk unavailable")
	}
	return s.Storage.Write(ctx, path, r)
}

func TestFailedAndCancelledImportsKeepStagedOriginals(t *testing.T) {
	for _, cancellation := range []bool{false, true} {
		t.Run(map[bool]string{false: "storage failure", true: "shutdown"}[cancellation], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			root := t.TempDir()
			database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			if err := db.Migrate(database, nil); err != nil {
				t.Fatal(err)
			}
			if _, err := database.Exec(`INSERT INTO users(id,username,password_hash) VALUES ('account-id','alice','hash')`); err != nil {
				t.Fatal(err)
			}
			store, err := storage.NewFS(root)
			if err != nil {
				t.Fatal(err)
			}
			broken := unavailableOriginalStore{Storage: store}
			if cancellation {
				broken.cancel = cancel
			}
			q, err := New(database, broken, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(q.StagingDir, "received")
			if err := os.MkdirAll(source, 0o700); err != nil {
				t.Fatal(err)
			}
			original := filepath.Join(source, "photo.jpg")
			writeJPEG(t, original)
			id, err := q.EnqueueStagedDirectory(ctx, "account-id", source, 1)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := database.Exec(`UPDATE jobs SET max_attempts=1 WHERE id=?`, id); err != nil {
				t.Fatal(err)
			}
			job, ok := q.claim(ctx)
			if !ok {
				t.Fatal("job not claimed")
			}
			q.process(ctx, job)
			if _, err := os.Stat(original); err != nil {
				t.Fatalf("received source was lost: %v", err)
			}
			var status string
			if err := database.QueryRow(`SELECT status FROM jobs WHERE id=?`, id).Scan(&status); err != nil {
				t.Fatal(err)
			}
			want := "failed"
			if cancellation {
				want = "running"
			}
			if status != want {
				t.Fatalf("status=%s want %s", status, want)
			}
		})
	}
}

func TestCaptureQueueImportsIntoResolvedAccount(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO users(id,username,password_hash) VALUES ('account-id','alice','hash')`); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(q.StagingDir, "capture")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	writeJPEG(t, filepath.Join(source, "phone.jpg"))
	if _, err := q.EnqueueStagedDirectory(ctx, "account-id", source, 1); err != nil {
		t.Fatal(err)
	}
	job, ok := q.claim(ctx)
	if !ok {
		t.Fatal("job not claimed")
	}
	q.process(ctx, job)
	var owner string
	if err := database.QueryRow(`SELECT owner_id FROM assets`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != "account-id" {
		t.Fatalf("imported owner=%q", owner)
	}
	var users int
	if err := database.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("unexpected account: users=%d err=%v", users, err)
	}
}
