//go:build !windows

package backup

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestBackupFinalizationFailureIsNotPublished(t *testing.T) {
	if os.Getenv("KURAKI_TEST_FINALIZATION_LIMIT") != "1" {
		child := exec.Command(os.Args[0], "-test.run=^TestBackupFinalizationFailureIsNotPublished$")
		child.Env = append(os.Environ(), "KURAKI_TEST_FINALIZATION_LIMIT=1")
		if bytes, err := child.CombinedOutput(); err != nil {
			t.Fatalf("finalization subprocess: %v\n%s", err, bytes)
		}
		return
	}
	source := t.TempDir()
	writeTree(t, source)
	destination := filepath.Join(t.TempDir(), "archive.tar.gz")
	var limit unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	signal.Ignore(unix.SIGXFSZ)
	limit.Cur = 128
	if err := unix.Setrlimit(unix.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	if err := Create(context.Background(), source, destination); err == nil {
		t.Fatal("limited output returned successful backup")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("partial archive published: %v", err)
	}
}
