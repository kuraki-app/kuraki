package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/auth"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// Roles. Kuraki's model is isolated libraries: an admin administers accounts
// and server settings, and has no path to another user's photos.
const (
	roleAdmin = "admin"
	roleUser  = "user"
)

const minPasswordLen = 8

// listUsers returns every account with the size of its library. The count
// exists so the UI can warn before a purge, not so an admin can browse.
// @Summary List users
// @Tags    users
// @Produce json
// @Success 200 {object} apitypes.UserList
// @Failure 401 {object} apitypes.Error
// @Failure 403 {object} apitypes.Error
// @Router  /api/users [get]
func (d Deps) listUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT u.id, u.username, u.role, u.created_at, u.disabled_at,
		       (SELECT COUNT(*) FROM assets a WHERE a.owner_id = u.id AND a.deleted_at IS NULL)
		FROM users u
		ORDER BY u.created_at ASC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "users_query_failed")
		return
	}
	defer rows.Close()

	out := apitypes.UserList{Users: make([]apitypes.UserSummary, 0)}
	for rows.Next() {
		var u apitypes.UserSummary
		var disabled sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &disabled, &u.AssetCount); err != nil {
			writeError(w, http.StatusInternalServerError, "users_scan_failed")
			return
		}
		if disabled.Valid {
			v := disabled.String
			u.DisabledAt = &v
		}
		out.Users = append(out.Users, u)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "users_scan_failed")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// createUser adds an account. There is no self-registration: an admin creates
// every account, which suits a self-hosted family server and keeps the
// unauthenticated surface to login and first-run setup only.
// @Summary Create user
// @Tags    users
// @Accept  json
// @Produce json
// @Param   body body apitypes.UserCreate true "new user"
// @Success 201 {object} apitypes.UserSummary
// @Failure 400 {object} apitypes.Error
// @Failure 403 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/users [post]
func (d Deps) createUser(w http.ResponseWriter, r *http.Request) {
	var req apitypes.UserCreate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		writeError(w, http.StatusBadRequest, "username_required")
		return
	}
	if len(req.Password) < minPasswordLen {
		writeError(w, http.StatusBadRequest, "password_too_short")
		return
	}
	role := req.Role
	if role == "" {
		role = roleUser
	}
	if role != roleAdmin && role != roleUser {
		writeError(w, http.StatusBadRequest, "invalid_role")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_failed")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "id_failed")
		return
	}
	_, err = d.DB.ExecContext(r.Context(),
		`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
		id.String(), username, hash, role)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "username_taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "create_user_failed")
		return
	}
	d.Logger.Info("user created", "user", id.String(), "username", username, "role", role)
	writeJSON(w, http.StatusCreated, apitypes.UserSummary{
		ID: id.String(), Username: username, Role: role,
	})
}

// patchUser changes a user's role, password, or enabled state.
// @Summary Update user
// @Tags    users
// @Accept  json
// @Produce json
// @Param   id   path string            true "user id"
// @Param   body body apitypes.UserPatch true "changes"
// @Success 200 {object} apitypes.UserSummary
// @Failure 400 {object} apitypes.Error
// @Failure 403 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/users/{id} [patch]
func (d Deps) patchUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var p apitypes.UserPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	var currentRole string
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT role FROM users WHERE id = ?`, id).Scan(&currentRole); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user_not_found")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup_failed")
		return
	}

	// Losing the last admin would leave the server unadministrable through
	// the UI, recoverable only via the CLI. Refuse rather than strand it.
	losingAdmin := (p.Role != nil && *p.Role != roleAdmin) || (p.Disabled != nil && *p.Disabled)
	if currentRole == roleAdmin && losingAdmin {
		last, err := d.isLastActiveAdmin(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "admin_count_failed")
			return
		}
		if last {
			writeError(w, http.StatusConflict, "last_admin")
			return
		}
	}

	if p.Role != nil {
		if *p.Role != roleAdmin && *p.Role != roleUser {
			writeError(w, http.StatusBadRequest, "invalid_role")
			return
		}
		if _, err := d.DB.ExecContext(r.Context(),
			`UPDATE users SET role = ? WHERE id = ?`, *p.Role, id); err != nil {
			writeError(w, http.StatusInternalServerError, "update_role_failed")
			return
		}
	}
	if p.Password != nil {
		if len(*p.Password) < minPasswordLen {
			writeError(w, http.StatusBadRequest, "password_too_short")
			return
		}
		hash, err := auth.HashPassword(*p.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "hash_failed")
			return
		}
		if _, err := d.DB.ExecContext(r.Context(),
			`UPDATE users SET password_hash = ? WHERE id = ?`, hash, id); err != nil {
			writeError(w, http.StatusInternalServerError, "update_password_failed")
			return
		}
		// A password change must not leave old sessions authenticated.
		if err := d.revokeAccess(r, id); err != nil {
			writeError(w, http.StatusInternalServerError, "revoke_failed")
			return
		}
	}
	if p.Disabled != nil {
		if *p.Disabled {
			if _, err := d.DB.ExecContext(r.Context(),
				`UPDATE users SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, id); err != nil {
				writeError(w, http.StatusInternalServerError, "disable_failed")
				return
			}
			// Disabling must take effect now, not whenever the session
			// happens to expire.
			if err := d.revokeAccess(r, id); err != nil {
				writeError(w, http.StatusInternalServerError, "revoke_failed")
				return
			}
			d.Logger.Info("user disabled", "user", id)
		} else {
			if _, err := d.DB.ExecContext(r.Context(),
				`UPDATE users SET disabled_at = NULL WHERE id = ?`, id); err != nil {
				writeError(w, http.StatusInternalServerError, "enable_failed")
				return
			}
			d.Logger.Info("user enabled", "user", id)
		}
	}

	summary, err := d.userSummary(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup_failed")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

// deleteUser removes an account. It refuses while the account still owns
// assets: deleting a person's entire library must be a deliberate act, not a
// side effect of tidying up a user list. ?purge=true opts in explicitly and
// destroys the assets, their derivatives, and their originals.
// @Summary Delete user
// @Tags    users
// @Produce json
// @Param   id    path  string true  "user id"
// @Param   purge query bool   false "also destroy the user's library"
// @Success 204
// @Failure 403 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.UserDeleteBlocked
// @Router  /api/users/{id} [delete]
func (d Deps) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	caller, _ := d.ownerID(r)
	if id == caller {
		writeError(w, http.StatusConflict, "cannot_delete_self")
		return
	}

	var role string
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT role FROM users WHERE id = ?`, id).Scan(&role); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user_not_found")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup_failed")
		return
	}
	if role == roleAdmin {
		last, err := d.isLastActiveAdmin(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "admin_count_failed")
			return
		}
		if last {
			writeError(w, http.StatusConflict, "last_admin")
			return
		}
	}

	var assetCount int
	if err := d.DB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM assets WHERE owner_id = ?`, id).Scan(&assetCount); err != nil {
		writeError(w, http.StatusInternalServerError, "asset_count_failed")
		return
	}
	if assetCount > 0 && r.URL.Query().Get("purge") != "true" {
		writeJSON(w, http.StatusConflict, apitypes.UserDeleteBlocked{
			Error: "user_has_assets", AssetCount: assetCount,
		})
		return
	}

	if assetCount > 0 {
		if err := d.purgeUserLibrary(r, id); err != nil {
			d.Logger.Error("purge user library failed", "user", id, "err", err)
			writeError(w, http.StatusInternalServerError, "purge_failed")
			return
		}
	}
	if _, err := d.DB.ExecContext(r.Context(), `DELETE FROM users WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete_user_failed")
		return
	}
	d.Logger.Info("user deleted", "user", id, "purged_assets", assetCount)
	w.WriteHeader(http.StatusNoContent)
}

// purgeUserLibrary destroys a user's assets and the files behind them. The DB
// rows go first only after the files, so a mid-purge failure leaves rows
// pointing at missing files (visible and repairable via media health) rather
// than orphaned files with no record that they exist.
func (d Deps) purgeUserLibrary(r *http.Request, userID string) error {
	ctx := r.Context()
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, original_path FROM assets WHERE owner_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("httpapi: list user assets: %w", err)
	}
	type asset struct{ id, path string }
	var assets []asset
	for rows.Next() {
		var a asset
		if err := rows.Scan(&a.id, &a.path); err != nil {
			rows.Close()
			return fmt.Errorf("httpapi: scan user asset: %w", err)
		}
		assets = append(assets, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("httpapi: iterate user assets: %w", err)
	}

	for _, a := range assets {
		derivs, err := d.DB.QueryContext(ctx, `SELECT path FROM derivatives WHERE asset_id = ?`, a.id)
		if err != nil {
			return fmt.Errorf("httpapi: list derivatives: %w", err)
		}
		for derivs.Next() {
			var p string
			if err := derivs.Scan(&p); err != nil {
				derivs.Close()
				return fmt.Errorf("httpapi: scan derivative: %w", err)
			}
			if err := d.Store.Remove(ctx, p); err != nil {
				d.Logger.Warn("purge: remove derivative failed", "asset", a.id, "path", p, "err", err)
			}
		}
		derivs.Close()
		if a.path != "" {
			if err := d.Store.Remove(ctx, "originals/"+a.path); err != nil {
				d.Logger.Warn("purge: remove original failed", "asset", a.id, "path", a.path, "err", err)
			}
		}
	}

	// assets cascade to derivatives, album_assets, asset_tags and media_issues
	// via ON DELETE CASCADE; albums and tags are owned rows in their own right.
	for _, stmt := range []string{
		`DELETE FROM assets WHERE owner_id = ?`,
		`DELETE FROM albums WHERE owner_id = ?`,
		`DELETE FROM tags WHERE owner_id = ?`,
		`DELETE FROM change_log WHERE owner_id = ?`,
	} {
		if _, err := d.DB.ExecContext(ctx, stmt, userID); err != nil {
			return fmt.Errorf("httpapi: purge rows: %w", err)
		}
	}
	return nil
}

// revokeAccess ends every active session and device token for a user, so
// disabling or a password reset takes effect immediately.
func (d Deps) revokeAccess(r *http.Request, userID string) error {
	if _, err := d.DB.ExecContext(r.Context(),
		`DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("httpapi: delete sessions: %w", err)
	}
	if _, err := d.DB.ExecContext(r.Context(),
		`UPDATE devices SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		 WHERE owner_id = ? AND revoked_at IS NULL`, userID); err != nil {
		return fmt.Errorf("httpapi: revoke devices: %w", err)
	}
	return nil
}

// isLastActiveAdmin reports whether id is the only admin who can still sign in.
func (d Deps) isLastActiveAdmin(r *http.Request, id string) (bool, error) {
	var others int
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM users WHERE role = ? AND disabled_at IS NULL AND id <> ?`,
		roleAdmin, id).Scan(&others)
	if err != nil {
		return false, fmt.Errorf("httpapi: count admins: %w", err)
	}
	return others == 0, nil
}

func (d Deps) userSummary(r *http.Request, id string) (apitypes.UserSummary, error) {
	var u apitypes.UserSummary
	var disabled sql.NullString
	err := d.DB.QueryRowContext(r.Context(), `
		SELECT u.id, u.username, u.role, u.created_at, u.disabled_at,
		       (SELECT COUNT(*) FROM assets a WHERE a.owner_id = u.id AND a.deleted_at IS NULL)
		FROM users u WHERE u.id = ?`, id).
		Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &disabled, &u.AssetCount)
	if err != nil {
		return u, fmt.Errorf("httpapi: user summary: %w", err)
	}
	if disabled.Valid {
		v := disabled.String
		u.DisabledAt = &v
	}
	return u, nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
