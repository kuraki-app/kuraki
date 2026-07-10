// Package stacks groups related captures — a RAW+JPEG pair or a Live/Motion
// Photo's image+video — so the timeline shows one representative with the rest a
// click away. Detection is deterministic and idempotent: assets sharing a base
// filename and capture day, with more than one file extension, form a stack.
package stacks

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
)

type member struct {
	id          string
	ext         string
	mediaType   string
	webViewable bool
	size        int64
}

// Detect (re)computes all stacks. Safe to run repeatedly.
func Detect(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id, owner_id, filename, media_type, web_viewable, size_bytes,
		       substr(COALESCE(taken_at, created_at), 1, 10)
		FROM assets WHERE deleted_at IS NULL`)
	if err != nil {
		return err
	}
	groups := map[string][]member{}
	for rows.Next() {
		var m member
		var owner, filename, day string
		var wv int
		if err := rows.Scan(&m.id, &owner, &filename, &m.mediaType, &wv, &m.size, &day); err != nil {
			rows.Close()
			return err
		}
		m.webViewable = wv != 0
		m.ext = strings.ToLower(filepath.Ext(filename))
		base := strings.ToLower(strings.TrimSuffix(filename, filepath.Ext(filename)))
		key := owner + "\x00" + base + "\x00" + day
		groups[key] = append(groups[key], m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Reset only currently-stacked rows, then reassign detected stacks.
	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET stack_id = NULL, stack_primary = 1 WHERE stack_id IS NOT NULL`); err != nil {
		return err
	}
	for _, members := range groups {
		if !isStack(members) {
			continue
		}
		primary := pickPrimary(members)
		for _, m := range members {
			p := 0
			if m.id == primary {
				p = 1
			}
			if _, err := tx.ExecContext(ctx,
				`UPDATE assets SET stack_id = ?, stack_primary = ? WHERE id = ?`, primary, p, m.id); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// isStack requires at least two files with different extensions (RAW+JPEG,
// image+video), so two coincidental same-name JPEGs are not merged.
func isStack(members []member) bool {
	if len(members) < 2 {
		return false
	}
	exts := map[string]bool{}
	for _, m := range members {
		exts[m.ext] = true
	}
	return len(exts) >= 2
}

func pickPrimary(members []member) string {
	best := members[0]
	for _, m := range members[1:] {
		if rank(m) > rank(best) || (rank(m) == rank(best) && m.size > best.size) {
			best = m
		}
	}
	return best.id
}

// rank prefers a browser-viewable image, then any image, then video, so the
// timeline shows the most useful representative.
func rank(m member) int {
	switch {
	case m.mediaType == "image" && m.webViewable:
		return 3
	case m.mediaType == "image":
		return 2
	default:
		return 1
	}
}
