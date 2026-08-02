package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/storage"
)

func TestCaptureUploadResumesAndQueuesImport(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := queue.New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Queue: q, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	deviceRec := postJSON(t, router, "/api/devices", apitypes.DeviceRequest{Name: "Test phone"}, cookie)
	if deviceRec.Code != http.StatusCreated {
		t.Fatalf("device status = %d body=%s", deviceRec.Code, deviceRec.Body.String())
	}
	var device apitypes.DeviceResponse
	if err := json.Unmarshal(deviceRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}
	if device.Token == "" {
		t.Fatal("device token missing")
	}

	source := filepath.Join(t.TempDir(), "camera.jpg")
	writeHTTPJPEG(t, source)
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	startBody, _ := json.Marshal(apitypes.CaptureStartRequest{Filename: "camera.jpg", SizeBytes: int64(len(data))})
	startReq := httptest.NewRequest(http.MethodPost, "/api/capture/uploads", bytes.NewReader(startBody))
	startReq.Header.Set("Content-Type", "application/json")
	startReq.Header.Set("Authorization", "Bearer "+device.Token)
	startRec := httptest.NewRecorder()
	router.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusCreated {
		t.Fatalf("start status = %d body=%s", startRec.Code, startRec.Body.String())
	}
	var session apitypes.CaptureSessionResponse
	if err := json.Unmarshal(startRec.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	first := len(data) / 2
	appendCaptureChunk(t, router, device.Token, session.ID, 0, data[:first], http.StatusOK)
	appendCaptureChunk(t, router, device.Token, session.ID, int64(first), data[first:], http.StatusOK)

	completeReq := httptest.NewRequest(http.MethodPost, "/api/capture/uploads/"+session.ID+"/complete", nil)
	completeReq.Header.Set("Authorization", "Bearer "+device.Token)
	completeRec := httptest.NewRecorder()
	router.ServeHTTP(completeRec, completeReq)
	if completeRec.Code != http.StatusAccepted {
		t.Fatalf("complete status = %d body=%s", completeRec.Code, completeRec.Body.String())
	}
	var completed apitypes.CaptureSessionResponse
	if err := json.Unmarshal(completeRec.Body.Bytes(), &completed); err != nil {
		t.Fatal(err)
	}
	if completed.JobID == "" || completed.Status != "queued" {
		t.Fatalf("completion = %+v", completed)
	}
	var status string
	if err := database.QueryRowContext(ctx, `SELECT status FROM jobs WHERE id = ?`, completed.JobID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "queued" {
		t.Fatalf("job status = %q, want queued", status)
	}

	revokeReq := httptest.NewRequest(http.MethodDelete, "/api/devices/"+device.ID, nil)
	revokeReq.AddCookie(cookie)
	revokeRec := httptest.NewRecorder()
	router.ServeHTTP(revokeRec, revokeReq)
	if revokeRec.Code != http.StatusOK {
		t.Fatalf("revoke status = %d body=%s", revokeRec.Code, revokeRec.Body.String())
	}
	statusReq := httptest.NewRequest(http.MethodGet, "/api/capture/status", nil)
	statusReq.Header.Set("Authorization", "Bearer "+device.Token)
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked device status = %d, want 401", statusRec.Code)
	}
}

func appendCaptureChunk(t *testing.T, handler http.Handler, token, id string, offset int64, body []byte, want int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/capture/uploads/"+id, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Upload-Offset", strconv.FormatInt(offset, 10))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("append status = %d body=%s", rec.Code, rec.Body.String())
	}
}

// A phone knows its camera roll's creation times; nothing in the upload
// protocol used to carry them, so a screenshot (which has no EXIF) imported
// with no capture date and grouped under "Undated" in every client. The
// handler hands the value to the importer by stamping the staged file's mtime,
// which is the channel the importer already reads.
func TestCaptureStartRecordsTakenAtAndStampsStagedFile(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := queue.New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Queue: q, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	deviceRec := postJSON(t, router, "/api/devices", apitypes.DeviceRequest{Name: "Test phone"}, cookie)
	var device apitypes.DeviceResponse
	if err := json.Unmarshal(deviceRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}

	source := filepath.Join(t.TempDir(), "Screenshot.jpg")
	writeHTTPJPEG(t, source)
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}

	want := time.Date(2026, 3, 14, 9, 26, 53, 0, time.UTC)
	startBody, _ := json.Marshal(apitypes.CaptureStartRequest{
		Filename:  "Screenshot.jpg",
		SizeBytes: int64(len(data)),
		TakenAt:   want.Format(time.RFC3339),
	})
	startReq := httptest.NewRequest(http.MethodPost, "/api/capture/uploads", bytes.NewReader(startBody))
	startReq.Header.Set("Content-Type", "application/json")
	startReq.Header.Set("Authorization", "Bearer "+device.Token)
	startRec := httptest.NewRecorder()
	router.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusCreated {
		t.Fatalf("start status = %d body=%s", startRec.Code, startRec.Body.String())
	}
	var session apitypes.CaptureSessionResponse
	if err := json.Unmarshal(startRec.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	var sourceDir string
	if err := database.QueryRowContext(ctx,
		`SELECT source_dir FROM upload_sessions WHERE id = ?`, session.ID).Scan(&sourceDir); err != nil {
		t.Fatal(err)
	}

	appendCaptureChunk(t, router, device.Token, session.ID, 0, data, http.StatusOK)

	completeReq := httptest.NewRequest(http.MethodPost, "/api/capture/uploads/"+session.ID+"/complete", nil)
	completeReq.Header.Set("Authorization", "Bearer "+device.Token)
	completeRec := httptest.NewRecorder()
	router.ServeHTTP(completeRec, completeReq)
	if completeRec.Code != http.StatusAccepted {
		t.Fatalf("complete status = %d body=%s", completeRec.Code, completeRec.Body.String())
	}

	// Writing the chunks sets mtime to now; completion must overwrite it with
	// the client's capture time, or the importer's fallback records the upload
	// time instead of when the photo was actually taken.
	info, err := os.Stat(filepath.Join(sourceDir, "Screenshot.jpg"))
	if err != nil {
		t.Fatalf("staged file: %v", err)
	}
	if !info.ModTime().UTC().Equal(want) {
		t.Fatalf("staged mtime = %s, want %s", info.ModTime().UTC(), want)
	}
}

// A client that sends junk, or nothing, must still be able to upload.
func TestCaptureStartIgnoresUnparseableTakenAt(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := queue.New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Queue: q, Logger: slog.Default()})
	cookie := setupTestSession(t, router)

	deviceRec := postJSON(t, router, "/api/devices", apitypes.DeviceRequest{Name: "Test phone"}, cookie)
	var device apitypes.DeviceResponse
	if err := json.Unmarshal(deviceRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}

	startBody, _ := json.Marshal(apitypes.CaptureStartRequest{
		Filename:  "camera.jpg",
		SizeBytes: 128,
		TakenAt:   "yesterday afternoon",
	})
	startReq := httptest.NewRequest(http.MethodPost, "/api/capture/uploads", bytes.NewReader(startBody))
	startReq.Header.Set("Content-Type", "application/json")
	startReq.Header.Set("Authorization", "Bearer "+device.Token)
	startRec := httptest.NewRecorder()
	router.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusCreated {
		t.Fatalf("start status = %d body=%s, want the upload to proceed without a usable date", startRec.Code, startRec.Body.String())
	}
	var session apitypes.CaptureSessionResponse
	if err := json.Unmarshal(startRec.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	var taken any
	if err := database.QueryRowContext(ctx,
		`SELECT taken_at FROM upload_sessions WHERE id = ?`, session.ID).Scan(&taken); err != nil {
		t.Fatal(err)
	}
	if taken != nil {
		t.Fatalf("taken_at = %v, want NULL for an unparseable value", taken)
	}
}
