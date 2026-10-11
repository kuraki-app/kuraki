package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

type delayedSetupBody struct {
	started, release chan struct{}
	reader           io.Reader
	startedRead      bool
}

func (b *delayedSetupBody) Read(p []byte) (int, error) {
	if !b.startedRead {
		b.startedRead = true
		close(b.started)
		<-b.release
	}
	return b.reader.Read(p)
}

func TestSetupRejectsARequestStartedBeforeAnotherClaim(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	body := &delayedSetupBody{started: make(chan struct{}), release: make(chan struct{}),
		reader: strings.NewReader(`{"username":"admin","password":"delayed-password"}`)}
	delayed := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		router.ServeHTTP(delayed, httptest.NewRequest(http.MethodPost, "/api/setup", body))
		close(done)
	}()
	select {
	case <-body.started:
	case <-time.After(5 * time.Second):
		t.Fatal("setup did not read the request")
	}
	claimed := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "admin", Password: "owner-password"}, nil)
	close(body.release)
	<-done
	if claimed.Code != http.StatusCreated || delayed.Code != http.StatusConflict {
		t.Fatalf("first claim=%d delayed claim=%d (%s)", claimed.Code, delayed.Code, delayed.Body)
	}
	if rec := postJSON(t, router, "/api/login", apitypes.Credentials{Username: "admin", Password: "owner-password"}, nil); rec.Code != http.StatusOK {
		t.Fatalf("original credentials stopped working: %d %s", rec.Code, rec.Body)
	}
}

func TestJobsDoNotExposeAnotherOwnersActivity(t *testing.T) {
	router, database := newAuthTestRouter(t)
	setup := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	cookie := findCookie(setup.Result().Cookies(), sessionCookieName)
	if _, err := database.Exec(`INSERT INTO users(id,username,password_hash) VALUES ('bob-id','bob','hash')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO jobs(id,kind,owner,source,status) VALUES ('bob-job','upload','bob','/staging/bob-job','failed')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO job_errors(job_id,filename,error) VALUES ('bob-job','private.jpg','private error')`); err != nil {
		t.Fatal(err)
	}
	list := getJSON(t, router, "/api/jobs", cookie)
	if list.Code != http.StatusOK || strings.Contains(list.Body.String(), "bob-job") {
		t.Fatalf("cross-owner job visible: %d %s", list.Code, list.Body)
	}
	detail := getJSON(t, router, "/api/jobs/bob-job", cookie)
	if detail.Code != http.StatusNotFound {
		t.Fatalf("cross-owner job detail=%d %s", detail.Code, detail.Body)
	}
}

func TestDisabledAccountCannotLogIn(t *testing.T) {
	router, database := newAuthTestRouter(t)
	postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	if _, err := database.Exec(`UPDATE users SET disabled_at='2026-10-11'`); err != nil {
		t.Fatal(err)
	}
	rec := postJSON(t, router, "/api/login", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	if rec.Code != http.StatusUnauthorized || findCookie(rec.Result().Cookies(), sessionCookieName) != nil {
		t.Fatalf("disabled login=%d cookies=%v", rec.Code, rec.Result().Cookies())
	}
}

func TestOversizedCredentialBodyIsRejected(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/setup", strings.NewReader(`{"username":"admin","password":"`+strings.Repeat("p", 2<<20)+`"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized setup=%d", rec.Code)
	}
}

func TestExternalLibraryRejectsAnAncestorOfManagedStorage(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	setup := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	cookie := findCookie(setup.Result().Cookies(), sessionCookieName)
	// Every temporary data directory is a descendant of the OS temp directory.
	rec := postJSON(t, router, "/api/external-libraries", apitypes.ExternalLibraryRequest{Name: "Parent", RootPath: filepath.Dir(os.TempDir())}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("ancestor root admitted: %d %s", rec.Code, rec.Body)
	}
}

func TestServerWideOperationsRequireAdministration(t *testing.T) {
	router, database := newAuthTestRouter(t)
	setup := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	cookie := findCookie(setup.Result().Cookies(), sessionCookieName)
	if _, err := database.Exec(`UPDATE users SET role='user'`); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/backup", "/api/integrity", "/metrics"} {
		if rec := getJSON(t, router, path, cookie); rec.Code != http.StatusForbidden {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
	}
	if rec := postJSON(t, router, "/api/integrity/run", struct{}{}, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("integrity run=%d", rec.Code)
	}
}

func TestExpectedAccountRejectsAChangedSessionBeforeUploads(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	setup := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	cookie := findCookie(setup.Result().Cookies(), sessionCookieName)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		req := httptest.NewRequest(method, "/api/assets", nil)
		req.AddCookie(cookie)
		req.Header.Set(expectedOwnerHeader, "other-account")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "account_changed") {
			t.Fatalf("changed account admitted: %d %s", rec.Code, rec.Body)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/assets", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unbound session upload=%d", rec.Code)
	}
}

func TestChangesResetsACursorBeyondRestoredHead(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	setup := postJSON(t, router, "/api/setup", apitypes.Credentials{Username: "alice", Password: "alice-password"}, nil)
	cookie := findCookie(setup.Result().Cookies(), sessionCookieName)
	result := getJSONWithCookie[apitypes.ChangesResponse](t, router, "/api/changes?since=999", cookie)
	if !result.Reset || result.Cursor != 0 || len(result.Changes) != 0 {
		t.Fatalf("cursor beyond restored head was not reset: %+v", result)
	}
}
