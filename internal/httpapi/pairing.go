package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

const pairingTTL = 5 * time.Minute

type pairingCodeResponse struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expires_at"`
}

type pairClaimRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// createPairingCode mints a short-lived, single-use code for an authenticated
// owner. The web app renders it as a QR (alongside its own origin) so a phone
// can pair without the owner copying a token by hand.
func (d Deps) createPairingCode(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	code, err := newDeviceToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_code_failed")
		return
	}
	expires := time.Now().UTC().Add(pairingTTL).Format(time.RFC3339Nano)
	if _, err := d.DB.ExecContext(r.Context(), `
		INSERT INTO pairing_codes (code, owner_id, expires_at) VALUES (?, ?, ?)`,
		code, user.ID, expires); err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_code_failed")
		return
	}
	writeJSON(w, http.StatusCreated, pairingCodeResponse{Code: code, ExpiresAt: expires})
}

// claimPairingCode is unauthenticated by necessity — the device has no
// credentials yet. It redeems a valid, unexpired, unclaimed code exactly once
// and returns a fresh device token. The claim is rate-limited per IP.
func (d Deps) claimPairingCode(w http.ResponseWriter, r *http.Request) {
	var req pairClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Code = strings.TrimSpace(req.Code)
	req.Name = strings.TrimSpace(req.Name)
	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_code")
		return
	}
	if req.Name == "" || len(req.Name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_device_name")
		return
	}

	var ownerID, expires string
	var claimedAt sql.NullString
	err := d.DB.QueryRowContext(r.Context(), `
		SELECT owner_id, expires_at, claimed_at FROM pairing_codes WHERE code = ?`, req.Code).
		Scan(&ownerID, &expires, &claimedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "invalid_code")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_lookup_failed")
		return
	}
	if claimedAt.Valid {
		writeError(w, http.StatusConflict, "code_already_used")
		return
	}
	if expiry, perr := time.Parse(time.RFC3339Nano, expires); perr != nil || time.Now().UTC().After(expiry) {
		writeError(w, http.StatusGone, "code_expired")
		return
	}

	deviceID, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "device_id_failed")
		return
	}
	token, err := newDeviceToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "device_token_failed")
		return
	}

	// Claim, create the device, and record its id atomically. Claiming first (a
	// guarded single-row update) means a concurrent redemption gets zero rows and
	// is rejected before any device is created; the device_id back-reference is
	// set only after the device row exists so the foreign key holds.
	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_claim_failed")
		return
	}
	defer tx.Rollback()

	now := nowCaptureText()
	claimed, err := tx.ExecContext(r.Context(), `
		UPDATE pairing_codes SET claimed_at = ? WHERE code = ? AND claimed_at IS NULL`, now, req.Code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_claim_failed")
		return
	}
	if n, _ := claimed.RowsAffected(); n != 1 {
		writeError(w, http.StatusConflict, "code_already_used")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO devices (id, owner_id, name, token_hash, last_seen_at)
		VALUES (?, ?, ?, ?, ?)`, deviceID.String(), ownerID, req.Name, hashDeviceToken(token), now); err != nil {
		writeError(w, http.StatusInternalServerError, "device_create_failed")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `
		UPDATE pairing_codes SET device_id = ? WHERE code = ?`, deviceID.String(), req.Code); err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_claim_failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_claim_failed")
		return
	}
	writeJSON(w, http.StatusCreated, deviceResponse{ID: deviceID.String(), Name: req.Name, Token: token})
}
