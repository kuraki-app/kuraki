package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCredentialWorkBoundsConcurrentSetupAcrossClients(t *testing.T) {
	slots := make(chan struct{}, 2)
	slots <- struct{}{}
	slots <- struct{}{}
	called := false
	handler := credentialConcurrency(slots)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/setup", nil)
	req.RemoteAddr = "198.51.100.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || called || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("overloaded setup: %d called=%v headers=%v", rec.Code, called, rec.Header())
	}
	<-slots
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || len(slots) != 1 {
		t.Fatalf("admission/release failed: %d slots=%d", rec.Code, len(slots))
	}
}
