package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

const captureChunkMaxBytes int64 = 32 << 20
const captureFileMaxBytes int64 = 20 << 30

type captureDevice struct {
	ID      string
	OwnerID string
}

type captureDeviceKey struct{}

// registerDevice creates a revocable bearer credential. It is returned once;
// mobile clients store it in platform secure storage rather than retaining the
// account password or a browser session cookie.
// @Summary Register device
// @Tags    devices
// @Accept  json
// @Produce json
// @Param   body body apitypes.DeviceRequest true "device name"
// @Success 201 {object} apitypes.DeviceResponse
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/devices [post]
func (d Deps) registerDevice(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req apitypes.DeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_device_name")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "device_id_failed")
		return
	}
	token, err := newDeviceToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "device_token_failed")
		return
	}
	if _, err := d.DB.ExecContext(r.Context(), `
		INSERT INTO devices (id, owner_id, name, token_hash, last_seen_at)
		VALUES (?, ?, ?, ?, ?)`, id.String(), user.ID, req.Name, hashDeviceToken(token), nowCaptureText()); err != nil {
		writeError(w, http.StatusInternalServerError, "device_create_failed")
		return
	}
	writeJSON(w, http.StatusCreated, apitypes.DeviceResponse{ID: id.String(), Name: req.Name, Token: token})
}

// @Summary Revoke device
// @Tags    devices
// @Produce json
// @Param   id path string true "device id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/devices/{id} [delete]
func (d Deps) revokeDevice(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	result, err := d.DB.ExecContext(r.Context(), `
		UPDATE devices SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL`, nowCaptureText(), r.PathValue("id"), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "device_revoke_failed")
		return
	}
	if count, _ := result.RowsAffected(); count != 1 {
		writeError(w, http.StatusNotFound, "device_not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (d Deps) requireDeviceAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		device, ok := d.resolveDevice(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "device_unauthorized")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), captureDeviceKey{}, device)))
	})
}

// resolveDevice validates the request's Bearer device token and, on success,
// touches last_seen_at and returns the owning device. It writes no HTTP
// response, so callers (requireDeviceAuth, requirePrincipal) decide how to
// react to a miss.
func (d Deps) resolveDevice(r *http.Request) (captureDevice, bool) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return captureDevice{}, false
	}
	var device captureDevice
	err := d.DB.QueryRowContext(r.Context(), `
		SELECT id, owner_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL`, hashDeviceToken(token)).
		Scan(&device.ID, &device.OwnerID)
	if err != nil {
		if err != sql.ErrNoRows && d.Logger != nil {
			d.Logger.Warn("device auth: lookup failed", "err", err)
		}
		return captureDevice{}, false
	}
	_, _ = d.DB.ExecContext(r.Context(), `UPDATE devices SET last_seen_at = ? WHERE id = ?`, nowCaptureText(), device.ID)
	return device, true
}

func deviceFromRequest(r *http.Request) captureDevice {
	device, _ := r.Context().Value(captureDeviceKey{}).(captureDevice)
	return device
}

// @Summary Start capture upload session
// @Tags    capture
// @Accept  json
// @Produce json
// @Param   body body apitypes.CaptureStartRequest true "filename + size"
// @Success 201 {object} apitypes.CaptureSessionResponse
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 503 {object} apitypes.Error
// @Router  /api/capture/uploads [post]
func (d Deps) captureStart(w http.ResponseWriter, r *http.Request) {
	if d.Queue == nil {
		writeError(w, http.StatusServiceUnavailable, "queue_unavailable")
		return
	}
	device := deviceFromRequest(r)
	var req apitypes.CaptureStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Filename = filepath.Base(strings.TrimSpace(req.Filename))
	if req.Filename == "" || req.Filename == "." || req.Filename == ".." || req.SizeBytes < 1 || req.SizeBytes > captureFileMaxBytes {
		writeError(w, http.StatusBadRequest, "invalid_upload")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload_id_failed")
		return
	}
	dir := filepath.Join(d.Queue.StagingDir, "capture", id.String())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "staging_failed")
		return
	}
	file, err := os.OpenFile(filepath.Join(dir, req.Filename), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		os.RemoveAll(dir)
		writeError(w, http.StatusInternalServerError, "staging_failed")
		return
	}
	if err := file.Close(); err != nil {
		os.RemoveAll(dir)
		writeError(w, http.StatusInternalServerError, "staging_failed")
		return
	}
	expires := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
	if _, err := d.DB.ExecContext(r.Context(), `
		INSERT INTO upload_sessions (id, device_id, owner_id, source_dir, filename, size_bytes, expires_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id.String(), device.ID, device.OwnerID, dir, req.Filename, req.SizeBytes, expires, nowCaptureText()); err != nil {
		os.RemoveAll(dir)
		writeError(w, http.StatusInternalServerError, "upload_create_failed")
		return
	}
	writeJSON(w, http.StatusCreated, apitypes.CaptureSessionResponse{ID: id.String(), Filename: req.Filename, SizeBytes: req.SizeBytes, Status: "receiving"})
}

// @Summary Append capture upload chunk
// @Tags    capture
// @Produce json
// @Param   id path string true "upload session id"
// @Success 200 {object} apitypes.CaptureSessionResponse
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/capture/uploads/{id} [patch]
func (d Deps) captureAppend(w http.ResponseWriter, r *http.Request) {
	device := deviceFromRequest(r)
	session, err := d.captureSession(r.Context(), r.PathValue("id"), device)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "upload_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload_lookup_failed")
		return
	}
	if session.Status != "receiving" || time.Now().UTC().After(session.expiresAt) {
		writeError(w, http.StatusConflict, "upload_not_receiving")
		return
	}
	offset, err := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	if err != nil || offset != session.ReceivedBytes {
		w.Header().Set("Upload-Offset", strconv.FormatInt(session.ReceivedBytes, 10))
		writeError(w, http.StatusConflict, "upload_offset_mismatch")
		return
	}
	remaining := session.SizeBytes - session.ReceivedBytes
	if remaining < 1 || (r.ContentLength > captureChunkMaxBytes) || (r.ContentLength > remaining) {
		writeError(w, http.StatusBadRequest, "invalid_chunk")
		return
	}
	limit := min(remaining, captureChunkMaxBytes)
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	file, err := os.OpenFile(filepath.Join(session.SourceDir, session.Filename), os.O_WRONLY, 0o600)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "staging_missing")
		return
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		file.Close()
		writeError(w, http.StatusInternalServerError, "staging_failed")
		return
	}
	written, copyErr := io.Copy(file, r.Body)
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written < 1 {
		writeError(w, http.StatusBadRequest, "chunk_write_failed")
		return
	}
	if written > remaining {
		writeError(w, http.StatusBadRequest, "invalid_chunk")
		return
	}
	newOffset := offset + written
	if _, err := d.DB.ExecContext(r.Context(), `UPDATE upload_sessions SET received_bytes = ?, updated_at = ? WHERE id = ?`, newOffset, nowCaptureText(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_update_failed")
		return
	}
	w.Header().Set("Upload-Offset", strconv.FormatInt(newOffset, 10))
	writeJSON(w, http.StatusOK, apitypes.CaptureSessionResponse{ID: session.ID, Filename: session.Filename, SizeBytes: session.SizeBytes, ReceivedBytes: newOffset, Status: "receiving"})
}

// @Summary Complete capture upload
// @Tags    capture
// @Produce json
// @Param   id path string true "upload session id"
// @Success 200 {object} apitypes.CaptureSessionResponse
// @Success 202 {object} apitypes.CaptureSessionResponse
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Failure 503 {object} apitypes.Error
// @Router  /api/capture/uploads/{id}/complete [post]
func (d Deps) captureComplete(w http.ResponseWriter, r *http.Request) {
	if d.Queue == nil {
		writeError(w, http.StatusServiceUnavailable, "queue_unavailable")
		return
	}
	device := deviceFromRequest(r)
	session, err := d.captureSession(r.Context(), r.PathValue("id"), device)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "upload_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload_lookup_failed")
		return
	}
	if session.JobID != "" {
		writeJSON(w, http.StatusOK, session.response())
		return
	}
	if session.Status != "receiving" || session.ReceivedBytes != session.SizeBytes {
		writeError(w, http.StatusConflict, "upload_incomplete")
		return
	}
	claimed, err := d.DB.ExecContext(r.Context(), `
		UPDATE upload_sessions SET status = 'queueing', updated_at = ?
		WHERE id = ? AND status = 'receiving' AND job_id IS NULL`, nowCaptureText(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload_claim_failed")
		return
	}
	if n, _ := claimed.RowsAffected(); n != 1 {
		writeError(w, http.StatusConflict, "upload_completing")
		return
	}
	jobID, err := d.Queue.EnqueueStagedDirectory(r.Context(), device.OwnerID, session.SourceDir, 1)
	if err != nil {
		_, _ = d.DB.ExecContext(r.Context(), `UPDATE upload_sessions SET status = 'receiving', error = ?, updated_at = ? WHERE id = ?`, err.Error(), nowCaptureText(), session.ID)
		writeError(w, http.StatusInternalServerError, "enqueue_failed")
		return
	}
	if _, err := d.DB.ExecContext(r.Context(), `UPDATE upload_sessions SET status = 'queued', job_id = ?, updated_at = ? WHERE id = ?`, jobID, nowCaptureText(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_complete_failed")
		return
	}
	session.Status, session.JobID = "queued", jobID
	writeJSON(w, http.StatusAccepted, session.response())
}

// @Summary Capture status
// @Tags    capture
// @Produce json
// @Success 200 {object} apitypes.CaptureStatusResponse
// @Failure 401 {object} apitypes.Error
// @Router  /api/capture/status [get]
func (d Deps) captureStatus(w http.ResponseWriter, r *http.Request) {
	device := deviceFromRequest(r)
	rows, err := d.DB.QueryContext(r.Context(), `
		SELECT s.id, s.filename, s.size_bytes, s.received_bytes,
			CASE
				WHEN s.status = 'queued' AND j.status = 'failed' THEN 'failed'
				WHEN s.status = 'queued' AND j.status = 'succeeded' THEN 'completed'
				ELSE s.status
			END,
			COALESCE(s.job_id, ''), CASE WHEN j.status = 'failed' THEN j.error ELSE s.error END
		FROM upload_sessions s LEFT JOIN jobs j ON j.id = s.job_id
		WHERE s.device_id = ? ORDER BY s.updated_at DESC LIMIT 50`, device.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "capture_status_failed")
		return
	}
	defer rows.Close()
	result := apitypes.CaptureStatusResponse{DeviceID: device.ID, Sessions: []apitypes.CaptureSessionResponse{}}
	for rows.Next() {
		var session captureSession
		if err := rows.Scan(&session.ID, &session.Filename, &session.SizeBytes, &session.ReceivedBytes, &session.Status, &session.JobID, &session.Error); err != nil {
			writeError(w, http.StatusInternalServerError, "capture_status_failed")
			return
		}
		switch session.Status {
		case "receiving", "queueing":
			result.Receiving++
		case "queued":
			result.Queued++
		case "failed":
			result.Failed++
		}
		result.Sessions = append(result.Sessions, session.response())
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "capture_status_failed")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

type captureSession struct {
	ID, SourceDir, Filename, Status, JobID, Error string
	SizeBytes, ReceivedBytes                      int64
	expiresAt                                     time.Time
}

func (d Deps) captureSession(ctx context.Context, id string, device captureDevice) (captureSession, error) {
	var session captureSession
	var expires string
	err := d.DB.QueryRowContext(ctx, `
		SELECT id, source_dir, filename, size_bytes, received_bytes, status, COALESCE(job_id, ''), error, expires_at
		FROM upload_sessions WHERE id = ? AND device_id = ? AND owner_id = ?`, id, device.ID, device.OwnerID).
		Scan(&session.ID, &session.SourceDir, &session.Filename, &session.SizeBytes, &session.ReceivedBytes, &session.Status, &session.JobID, &session.Error, &expires)
	if err != nil {
		return captureSession{}, err
	}
	session.expiresAt, err = time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return captureSession{}, fmt.Errorf("capture: parse expiry: %w", err)
	}
	return session, nil
}

func (s captureSession) response() apitypes.CaptureSessionResponse {
	return apitypes.CaptureSessionResponse{ID: s.ID, Filename: s.Filename, SizeBytes: s.SizeBytes, ReceivedBytes: s.ReceivedBytes, Status: s.Status, JobID: s.JobID, Error: s.Error}
}

func newDeviceToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashDeviceToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func nowCaptureText() string { return time.Now().UTC().Format(time.RFC3339Nano) }
