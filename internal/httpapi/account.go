package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/auth"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// changePassword lets the signed-in owner rotate their password. It verifies the
// current password, stores a fresh argon2id hash, and invalidates every other
// session so a leaked or shared cookie cannot outlive the rotation — the caller's
// own session is preserved and re-issued so they are not logged out mid-change.
// @Summary Change password
// @Tags    account
// @Accept  json
// @Produce json
// @Param   body body apitypes.ChangePasswordRequest true "current + new password"
// @Success 200 {object} map[string]string
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/account/password [post]
func (d Deps) changePassword(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req apitypes.ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "password_too_short")
		return
	}

	var passwordHash string
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT password_hash FROM users WHERE id = ? AND password_hash <> ''`,
		user.ID).Scan(&passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password_change_failed")
		return
	}

	ok, err := auth.VerifyPassword(req.CurrentPassword, passwordHash)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_password_failed")
		return
	}

	// The current session id is the cookie value; keep it and drop the rest.
	var currentSession string
	if c, err := r.Cookie(sessionCookieName); err == nil {
		currentSession = c.Value
	}

	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password_change_failed")
		return
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(r.Context(),
		`UPDATE users SET password_hash = ? WHERE id = ?`, newHash, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "password_change_failed")
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`DELETE FROM sessions WHERE user_id = ? AND id <> ?`, user.ID, currentSession); err != nil {
		writeError(w, http.StatusInternalServerError, "password_change_failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "password_change_failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
