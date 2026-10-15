package queue

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
)

// Receipt publication is part of job finalization. Import state also covers a
// crash/retry that skips an original already committed by the previous attempt.
func recordCaptureReceipts(ctx context.Context, tx *sql.Tx, source, owner string) error {
	rows, err := tx.QueryContext(ctx, `SELECT id, filename FROM upload_sessions WHERE source_dir=? AND owner_id=?`, source, owner)
	if err != nil {
		return fmt.Errorf("queue: find capture sessions: %w", err)
	}
	type session struct{ id, filename string }
	var sessions []session
	for rows.Next() {
		var s session
		if err := rows.Scan(&s.id, &s.filename); err != nil {
			rows.Close()
			return err
		}
		sessions = append(sessions, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, s := range sessions {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO capture_receipts(upload_id,owner_id,asset_id,content_hash,size_bytes)
			SELECT ?, a.owner_id, a.id, a.content_hash, a.size_bytes
			FROM import_state i JOIN assets a ON a.content_hash=i.content_hash AND a.owner_id=i.owner_id
			WHERE i.owner_id=? AND a.owner_id=? AND i.source_path=?
			  AND i.status IN ('done','skipped') AND a.deleted_at IS NULL
			ON CONFLICT(upload_id) DO NOTHING`, s.id, owner, owner, filepath.Join(source, s.filename))
		if err != nil {
			return fmt.Errorf("queue: publish original receipt: %w", err)
		}
	}
	return nil
}
