// Package serversettings persists admin-writable server configuration
// (internal/config's Catalog) as key/value rows. It is the only package that
// touches the server_settings table directly.
package serversettings

import (
	"context"
	"database/sql"
	"fmt"
)

// LoadAll returns every stored setting as key -> value.
func LoadAll(ctx context.Context, db *sql.DB) (map[string]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT key, value FROM server_settings`)
	if err != nil {
		return nil, fmt.Errorf("serversettings: load: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, fmt.Errorf("serversettings: scan: %w", err)
		}
		out[k] = v
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("serversettings: iterate: %w", err)
	}
	return out, nil
}

// Save upserts one setting's value. An empty value is stored as a real row
// (a deliberate "clear this"), not skipped — see internal/config.ApplyDB.
func Save(ctx context.Context, db *sql.DB, key, value string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO server_settings (key, value, updated_at)
		VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value)
	if err != nil {
		return fmt.Errorf("serversettings: save %s: %w", key, err)
	}
	return nil
}
