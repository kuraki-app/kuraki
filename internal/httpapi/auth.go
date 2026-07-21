package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/auth"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

const sessionCookieName = "kuraki_session"

// setupStatus reports whether initial setup is required and, if signed in,
// the current user.
// @Summary Setup status
// @Tags    auth
// @Produce json
// @Success 200 {object} apitypes.SetupStatus
// @Router  /api/setup [get]
func (d Deps) setupStatus(w http.ResponseWriter, r *http.Request) {
	required, err := d.setupRequired(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "setup_status_failed")
		return
	}
	user := d.currentUser(r)
	writeJSON(w, http.StatusOK, apitypes.SetupStatus{SetupRequired: required, User: user})
}

// setup claims the placeholder owner account on a fresh install.
// @Summary Complete initial setup
// @Tags    auth
// @Accept  json
// @Produce json
// @Param   body body apitypes.Credentials true "owner credentials"
// @Success 201 {object} apitypes.SetupStatus
// @Failure 400 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/setup [post]
func (d Deps) setup(w http.ResponseWriter, r *http.Request) {
	required, err := d.setupRequired(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "setup_status_failed")
		return
	}
	if !required {
		writeError(w, http.StatusConflict, "setup_already_complete")
		return
	}
	var req apitypes.Credentials
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		// Default the owner account name; the placeholder row that CLI imports
		// create (username "owner", empty password) is still claimed by
		// upsertSetupUser regardless of the name chosen here.
		req.Username = "admin"
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password_too_short")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_password_failed")
		return
	}

	userID, err := d.upsertSetupUser(r.Context(), req.Username, hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "setup_user_failed")
		return
	}
	if err := d.createSession(w, r, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "create_session_failed")
		return
	}
	writeJSON(w, http.StatusCreated, apitypes.SetupStatus{
		SetupRequired: false,
		User:          &apitypes.User{ID: userID, Username: req.Username},
	})
}

// login authenticates with username/password and starts a session.
// @Summary Log in
// @Tags    auth
// @Accept  json
// @Produce json
// @Param   body body apitypes.Credentials true "credentials"
// @Success 200 {object} apitypes.SetupStatus
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/login [post]
func (d Deps) login(w http.ResponseWriter, r *http.Request) {
	var req apitypes.Credentials
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	var userID, username, passwordHash string
	err := d.DB.QueryRowContext(r.Context(),
		`SELECT id, username, password_hash FROM users WHERE username = ? AND password_hash <> ''`,
		req.Username).Scan(&userID, &username, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "login_failed")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, passwordHash)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	if err := d.createSession(w, r, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "create_session_failed")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.SetupStatus{
		SetupRequired: false,
		User:          &apitypes.User{ID: userID, Username: username},
	})
}

// logout clears the session cookie.
// @Summary Log out
// @Tags    auth
// @Produce json
// @Success 200 {object} map[string]string
// @Router  /api/logout [post]
func (d Deps) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		_, _ = d.DB.ExecContext(r.Context(), `DELETE FROM sessions WHERE id = ?`, cookie.Value)
	}
	http.SetCookie(w, d.expiredSessionCookie())
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// me returns the signed-in owner, or setup status when not signed in.
// @Summary Current user
// @Tags    auth
// @Produce json
// @Success 200 {object} apitypes.SetupStatus
// @Failure 401 {object} apitypes.Error
// @Router  /api/me [get]
func (d Deps) me(w http.ResponseWriter, r *http.Request) {
	required, err := d.setupRequired(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "setup_status_failed")
		return
	}
	user := d.currentUser(r)
	if user == nil && !required {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, apitypes.SetupStatus{SetupRequired: required, User: user})
}

func (d Deps) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		required, err := d.setupRequired(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "setup_status_failed")
			return
		}
		if required {
			writeError(w, http.StatusForbidden, "setup_required")
			return
		}
		if d.currentUser(r) != nil {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
	})
}

func (d Deps) setupRequired(ctx context.Context) (bool, error) {
	var count int
	if err := d.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE password_hash <> ''`).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (d Deps) upsertSetupUser(ctx context.Context, username, passwordHash string) (string, error) {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var id string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM users WHERE username = ? OR (username = 'owner' AND password_hash = '') ORDER BY username = ? DESC LIMIT 1`,
		username, username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		newID, err := uuid.NewV7()
		if err != nil {
			return "", err
		}
		id = newID.String()
		_, err = tx.ExecContext(ctx,
			`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`,
			id, username, passwordHash)
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		_, err = tx.ExecContext(ctx,
			`UPDATE users SET username = ?, password_hash = ? WHERE id = ?`,
			username, passwordHash, id)
		if err != nil {
			return "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

func (d Deps) createSession(w http.ResponseWriter, r *http.Request, userID string) error {
	sessionID, err := auth.NewSessionID()
	if err != nil {
		return err
	}
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	if _, err := d.DB.ExecContext(r.Context(),
		`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
		sessionID, userID, expires.Format(time.RFC3339Nano)); err != nil {
		return err
	}
	http.SetCookie(w, d.sessionCookie(sessionID, expires))
	return nil
}

func (d Deps) currentUser(r *http.Request) *apitypes.User {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var user apitypes.User
	err = d.DB.QueryRowContext(r.Context(), `
		SELECT u.id, u.username
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = ? AND s.expires_at > ?
	`, cookie.Value, now).Scan(&user.ID, &user.Username)
	if err != nil {
		return nil
	}
	return &user
}

// ownerID returns the authenticated owner under either auth mode. Device auth
// (Bearer) carries device.OwnerID; session auth carries the cookie user. Inside
// an authed route group exactly one is present; if neither is, the caller must
// treat it as unauthorized rather than dereferencing a nil user.
func (d Deps) ownerID(r *http.Request) (string, bool) {
	if dev := deviceFromRequest(r); dev.OwnerID != "" {
		return dev.OwnerID, true
	}
	if u := d.currentUser(r); u != nil {
		return u.ID, true
	}
	return "", false
}

func (d Deps) sessionCookie(value string, expires time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   d.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
}

func (d Deps) expiredSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   d.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
}
