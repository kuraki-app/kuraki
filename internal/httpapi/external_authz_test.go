package httpapi

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// signedInAs mints a session row directly for a user, which is the only way to
// get a NON-admin session: the login route is fine, but these users are created
// straight in the fixture without a password hash.
func signedInAs(t *testing.T, database *sql.DB, userID string) *http.Cookie {
	t.Helper()
	token := "test-session-" + userID
	if _, err := database.Exec(`INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)`,
		token, userID, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: sessionCookieName, Value: token}
}

// TestExternalLibraryRequiresAdmin proves a non-admin account cannot name a
// path on the server's filesystem.
//
// The route only ever checked for *a* session. `external.Scan` walks whatever
// root it is given and inserts every media file it finds as an asset owned by
// the CALLER, so any signed-in user could point one at the data directory and
// index every other owner's photos into their own library — defeating the
// isolation the project treats as an invariant. `ownerscope_guard_test.go`
// cannot see this: the SQL is correctly owner-scoped, it is the FILES that were
// attacker-chosen.
func TestExternalLibraryRequiresAdmin(t *testing.T) {
	router, cookie, database := deviceFavoriteRouter(t)

	// A second, non-admin account, signed in.
	if _, err := database.Exec(
		`INSERT INTO users(id,username,password_hash,role) VALUES('u2','member','x','user')`); err != nil {
		t.Fatal(err)
	}
	memberCookie := signedInAs(t, database, "u2")

	rec := postJSON(t, router, "/api/external-libraries",
		apitypes.ExternalLibraryRequest{Name: "theirs", RootPath: t.TempDir()}, memberCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin create = %d, want 403 (body=%s)", rec.Code, rec.Body.String())
	}

	// The admin can still use the feature.
	rec = postJSON(t, router, "/api/external-libraries",
		apitypes.ExternalLibraryRequest{Name: "mine", RootPath: t.TempDir()}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin create = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestExternalLibraryRefusesDataDir proves admin-only is not the whole fix.
//
// AGENTS.md states that an admin manages accounts, NOT photos, and that there
// is no path from one account to another's library. A library rooted inside the
// data directory would be exactly that path: originals/ holds every owner's
// files and a scan claims whatever it walks.
func TestExternalLibraryRefusesDataDir(t *testing.T) {
	router, cookie, _, store := deviceTrashTestRouter(t)
	fs, ok := store.(*storage.FS)
	if !ok {
		t.Skip("storage is not filesystem-backed")
	}
	base := fs.Base

	for _, root := range []string{base, filepath.Join(base, "originals")} {
		rec := postJSON(t, router, "/api/external-libraries",
			apitypes.ExternalLibraryRequest{Name: "sneaky", RootPath: root}, cookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("create rooted at %q = %d, want 400", root, rec.Code)
		}
	}
}
