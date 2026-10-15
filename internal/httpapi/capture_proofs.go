package httpapi

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/storage"
	"github.com/zeebo/blake3"
)

func (d Deps) serverIdentity(ctx context.Context) (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	if _, err := d.DB.ExecContext(ctx, `INSERT INTO server_identity(singleton,id) VALUES(1,?) ON CONFLICT(singleton) DO NOTHING`, id.String()); err != nil {
		return "", err
	}
	var actual string
	err = d.DB.QueryRowContext(ctx, `SELECT id FROM server_identity WHERE singleton=1`).Scan(&actual)
	return actual, err
}

// @Summary Authenticated library identity
// @Tags capture
// @Produce json
// @Success 200 {object} apitypes.CaptureIdentity
// @Failure 401 {object} apitypes.Error
// @Router /api/capture/identity [get]
func (d Deps) captureIdentity(w http.ResponseWriter, r *http.Request) {
	id, err := d.serverIdentity(r.Context())
	if err != nil {
		writeError(w, 500, "identity_failed")
		return
	}
	writeJSON(w, 200, apitypes.CaptureIdentity{ServerID: id, OwnerID: deviceFromRequest(r).OwnerID})
}

// @Summary Original import receipt
// @Tags capture
// @Produce json
// @Param id path string true "upload id"
// @Success 200 {object} apitypes.CaptureReceiptResponse
// @Success 202 {object} apitypes.CaptureReceiptResponse
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Failure 410 {object} apitypes.Error
// @Router /api/capture/uploads/{id}/receipt [get]
func (d Deps) captureReceipt(w http.ResponseWriter, r *http.Request) {
	owner := deviceFromRequest(r).OwnerID
	var proof apitypes.OriginalProof
	var path string
	err := d.DB.QueryRowContext(r.Context(), `
		SELECT c.asset_id,c.content_hash,c.size_bytes,a.original_path
		FROM capture_receipts c JOIN assets a ON a.id=c.asset_id AND a.owner_id=c.owner_id
		WHERE c.upload_id=? AND c.owner_id=? AND a.owner_id=? AND a.deleted_at IS NULL`,
		r.PathValue("id"), owner, owner).Scan(&proof.AssetID, &proof.ContentHash, &proof.SizeBytes, &path)
	if err == nil {
		// A receipt is not deletion permission. Verification rehashes at the
		// moment reclamation is requested; this read only checks availability.
		size, err := d.Store.Size(r.Context(), "originals/"+path)
		if err != nil || size != proof.SizeBytes {
			writeError(w, 410, "original_unavailable")
			return
		}
		writeJSON(w, 200, apitypes.CaptureReceiptResponse{Status: "completed", Proof: &proof})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		writeError(w, 500, "receipt_failed")
		return
	}
	var status string
	err = d.DB.QueryRowContext(r.Context(), `SELECT COALESCE(j.status,s.status) FROM upload_sessions s LEFT JOIN jobs j ON j.id=s.job_id WHERE s.id=? AND s.owner_id=?`, r.PathValue("id"), owner).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "upload_not_found")
		return
	}
	if err != nil {
		writeError(w, 500, "receipt_failed")
		return
	}
	if status == "failed" || status == "succeeded" {
		writeError(w, 410, "original_unavailable")
		return
	}
	writeJSON(w, 202, apitypes.CaptureReceiptResponse{Status: "pending"})
}

// @Summary Verify current immutable original before removing a local copy
// @Tags capture
// @Accept json
// @Produce json
// @Param body body apitypes.OriginalProof true "expected original content"
// @Success 200 {object} apitypes.CaptureReceiptResponse
// @Failure 400 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router /api/capture/originals/verify [post]
func (d Deps) verifyCaptureOriginal(w http.ResponseWriter, r *http.Request) {
	select {
	case d.proofSlots <- struct{}{}:
		defer func() { <-d.proofSlots }()
	default:
		w.Header().Set("Retry-After", "2")
		writeError(w, 503, "original_verification_busy")
		return
	}
	var proof apitypes.OriginalProof
	if json.NewDecoder(r.Body).Decode(&proof) != nil || proof.AssetID == "" || proof.SizeBytes <= 0 || proof.SizeBytes > captureFileMaxBytes || len(proof.ContentHash) != 64 {
		writeError(w, 400, "invalid_original_proof")
		return
	}
	if _, err := hex.DecodeString(proof.ContentHash); err != nil {
		writeError(w, 400, "invalid_original_proof")
		return
	}
	unlock, err := storage.LockLibrary(r.Context(), d.Store, false)
	if err != nil {
		writeError(w, 500, "original_verify_failed")
		return
	}
	defer unlock()
	var original, hash string
	var size int64
	err = d.DB.QueryRowContext(r.Context(), `SELECT original_path,content_hash,size_bytes FROM assets WHERE id=? AND owner_id=? AND deleted_at IS NULL AND external_path IS NULL`, proof.AssetID, deviceFromRequest(r).OwnerID).Scan(&original, &hash, &size)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "original_not_found")
		return
	}
	if err != nil {
		writeError(w, 500, "original_verify_failed")
		return
	}
	if hash != proof.ContentHash || size != proof.SizeBytes {
		writeError(w, 409, "original_content_changed")
		return
	}
	f, err := d.Store.Open(r.Context(), "originals/"+original)
	if err != nil {
		writeError(w, 409, "original_unavailable")
		return
	}
	defer f.Close()
	h := blake3.New()
	buffer := make([]byte, 256<<10)
	var read int64
	for {
		if r.Context().Err() != nil {
			return
		}
		n, e := f.Read(buffer)
		read += int64(n)
		if n > 0 {
			_, _ = h.Write(buffer[:n])
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			writeError(w, 409, "original_unavailable")
			return
		}
		if read > proof.SizeBytes {
			writeError(w, 409, "original_content_changed")
			return
		}
	}
	if read != size || hex.EncodeToString(h.Sum(nil)) != hash {
		writeError(w, 409, "original_content_changed")
		return
	}
	writeJSON(w, 200, apitypes.CaptureReceiptResponse{Status: "verified", Proof: &proof})
}

// @Summary Check bounded original availability for backup recovery
// @Tags capture
// @Accept json
// @Produce json
// @Param body body apitypes.CaptureAvailability true "expected originals (maximum 200)"
// @Success 200 {object} apitypes.CaptureAvailabilityResponse
// @Failure 400 {object} apitypes.Error
// @Router /api/capture/originals/available [post]
func (d Deps) captureAvailability(w http.ResponseWriter, r *http.Request) {
	var body apitypes.CaptureAvailability
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Originals) > 200 {
		writeError(w, 400, "invalid_originals")
		return
	}
	result := apitypes.CaptureAvailabilityResponse{Available: []string{}}
	for _, proof := range body.Originals {
		var path string
		err := d.DB.QueryRowContext(r.Context(), `SELECT original_path FROM assets WHERE id=? AND owner_id=? AND deleted_at IS NULL AND external_path IS NULL AND content_hash=? AND size_bytes=?`, proof.AssetID, deviceFromRequest(r).OwnerID, proof.ContentHash, proof.SizeBytes).Scan(&path)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			writeError(w, 500, "availability_failed")
			return
		}
		size, err := d.Store.Size(r.Context(), "originals/"+path)
		if err == nil && size == proof.SizeBytes {
			result.Available = append(result.Available, proof.AssetID)
		}
	}
	writeJSON(w, 200, result)
}
