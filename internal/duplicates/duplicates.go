// Package duplicates owns durable, resumable all-library dHash scans.
package duplicates

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/media"
)

const AlgorithmVersion = 1
const Threshold = 8

type Run struct {
	ID, Status, Error        string
	Total, Processed, Groups int
}

// Enqueue creates a persistent run. Start owns execution and recovers queued
// work after a server restart.
func Enqueue(ctx context.Context, db *sql.DB, ownerID string) (Run, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return Run{}, err
	}
	run := Run{ID: id.String(), Status: "queued"}
	_, err = db.ExecContext(ctx, `INSERT INTO duplicate_runs(id,owner_id,status,algorithm_version) VALUES(?,?,?,?)`, run.ID, ownerID, run.Status, AlgorithmVersion)
	return run, err
}

// Start continuously claims one queued run. Interrupted runs are re-queued on
// startup; partial members are cleared before retry, so the result is atomic.
func Start(ctx context.Context, db *sql.DB, log *slog.Logger) {
	_, _ = db.ExecContext(ctx, `UPDATE duplicate_runs SET status='queued', error='' WHERE status='running'`)
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			if id, ok := claim(ctx, db); ok {
				if _, err := Execute(ctx, db, id); err != nil && log != nil {
					log.Warn("duplicate scan failed", "run", id, "err", err)
				}
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func claim(ctx context.Context, db *sql.DB) (string, bool) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", false
	}
	defer tx.Rollback()
	var id string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM duplicate_runs WHERE status='queued' ORDER BY created_at LIMIT 1`).Scan(&id); err != nil {
		return "", false
	}
	res, err := tx.ExecContext(ctx, `UPDATE duplicate_runs SET status='running', started_at=? WHERE id=? AND status='queued'`, now(), id)
	if err != nil {
		return "", false
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return "", false
	}
	return id, tx.Commit() == nil
}

func Execute(ctx context.Context, db *sql.DB, runID string) (Run, error) {
	var run Run
	var ownerID string
	if err := db.QueryRowContext(ctx, `SELECT owner_id,status,total,processed,group_count,error FROM duplicate_runs WHERE id=?`, runID).Scan(&ownerID, &run.Status, &run.Total, &run.Processed, &run.Groups, &run.Error); err != nil {
		return Run{}, err
	}
	run.ID = runID
	finish := func(err error) (Run, error) {
		if err != nil {
			run.Status, run.Error = "failed", err.Error()
		} else {
			run.Status, run.Error = "succeeded", ""
		}
		_, _ = db.ExecContext(ctx, `UPDATE duplicate_runs SET status=?,total=?,processed=?,group_count=?,error=?,finished_at=? WHERE id=?`, run.Status, run.Total, run.Processed, run.Groups, run.Error, now(), run.ID)
		return run, err
	}
	rows, err := db.QueryContext(ctx, `SELECT id,phash FROM assets WHERE owner_id=? AND media_type='image' AND phash IS NOT NULL AND deleted_at IS NULL`, ownerID)
	if err != nil {
		return finish(err)
	}
	defer rows.Close()
	var ids []string
	var hashes []uint64
	for rows.Next() {
		var id string
		var h int64
		if err := rows.Scan(&id, &h); err != nil {
			return finish(err)
		}
		ids = append(ids, id)
		hashes = append(hashes, uint64(h))
	}
	if err := rows.Err(); err != nil {
		return finish(err)
	}
	run.Total = len(ids)
	parent := make([]int, len(ids))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	buckets := make(map[string][]int, len(ids)*2)
	for i, h := range hashes {
		if err := ctx.Err(); err != nil {
			return finish(err)
		}
		for _, key := range bands(h) {
			for _, j := range buckets[key] {
				if media.Hamming(h, hashes[j]) <= Threshold {
					parent[find(i)] = find(j)
				}
			}
			buckets[key] = append(buckets[key], i)
		}
		run.Processed = i + 1
		if run.Processed%1000 == 0 {
			_, _ = db.ExecContext(ctx, `UPDATE duplicate_runs SET total=?,processed=? WHERE id=?`, run.Total, run.Processed, run.ID)
		}
	}
	groups := map[int][]string{}
	for i, id := range ids {
		root := find(i)
		groups[root] = append(groups[root], id)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return finish(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM duplicate_group_members WHERE run_id=?`, run.ID); err != nil {
		return finish(err)
	}
	groupID := 0
	for _, members := range groups {
		if len(members) < 2 {
			continue
		}
		groupID++
		for _, assetID := range members {
			if _, err := tx.ExecContext(ctx, `INSERT INTO duplicate_group_members(run_id,group_id,asset_id) VALUES(?,?,?)`, run.ID, groupID, assetID); err != nil {
				return finish(err)
			}
		}
	}
	run.Groups = groupID
	if err := tx.Commit(); err != nil {
		return finish(err)
	}
	return finish(nil)
}

func Latest(ctx context.Context, db *sql.DB, ownerID string) (Run, bool, error) {
	var r Run
	err := db.QueryRowContext(ctx, `SELECT id,status,total,processed,group_count,error FROM duplicate_runs WHERE owner_id=? ORDER BY created_at DESC LIMIT 1`, ownerID).Scan(&r.ID, &r.Status, &r.Total, &r.Processed, &r.Groups, &r.Error)
	if err == sql.ErrNoRows {
		return Run{}, false, nil
	}
	return r, err == nil, err
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func bands(h uint64) [9]string {
	var out [9]string
	shift := uint(0)
	for i := range out {
		width := uint(7)
		if i == 8 {
			width = 8
		}
		out[i] = fmt.Sprintf("%d:%d", i, (h>>shift)&((uint64(1)<<width)-1))
		shift += width
	}
	return out
}
