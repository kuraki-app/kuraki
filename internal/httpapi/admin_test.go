package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// deleteWithCookie issues a DELETE and returns the recorder unasserted.
func deleteWithCookie(t *testing.T, handler http.Handler, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// decodeJSON unmarshals a recorded response body, failing the test on error.
func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("decode response %s: %v", rec.Body.String(), err)
	}
}

// makeNonAdmin demotes the sole owner so the caller's cookie is a plain user.
func makeNonAdmin(t *testing.T, database *sql.DB) {
	t.Helper()
	if _, err := database.Exec(`UPDATE users SET role = 'user'`); err != nil {
		t.Fatal(err)
	}
}

// TestSetupCreatesAdmin proves first-run setup claims administration. On a
// fresh install migration 00023's backfill never runs, so without an explicit
// role the first user would default to 'user' and nobody could administer the
// server.
func TestSetupCreatesAdmin(t *testing.T) {
	_, _, db := deviceFavoriteRouter(t)
	var role string
	if err := db.QueryRow(`SELECT role FROM users`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != roleAdmin {
		t.Fatalf("first user role = %q, want admin", role)
	}
}

// TestAdminRoutesRejectNonAdmin proves a plain user cannot reach account
// administration.
func TestAdminRoutesRejectNonAdmin(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	makeNonAdmin(t, db)

	rec := getRawWithCookie(t, router, "/api/users", cookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("GET /api/users as non-admin = %d, want 403", rec.Code)
	}
	rec = postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "x", Password: "password123"}, cookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /api/users as non-admin = %d, want 403", rec.Code)
	}
}

// TestAdminRoutesRejectDeviceToken proves a device token cannot administer
// accounts. A stolen phone must not be able to create an account.
func TestAdminRoutesRejectDeviceToken(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)

	rec := deviceJSON(t, router, http.MethodGet, "/api/users", token, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("GET /api/users with device token = %d, want 403", rec.Code)
	}
}

// TestCreateAndListUsers covers the happy path and the duplicate-name guard.
func TestCreateAndListUsers(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)

	rec := postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "alice", Password: "password123"}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create user = %d body=%s, want 201", rec.Code, rec.Body.String())
	}

	list := getJSONWithCookie[apitypes.UserList](t, router, "/api/users", cookie)
	if len(list.Users) != 2 {
		t.Fatalf("user count = %d, want 2", len(list.Users))
	}
	var alice *apitypes.UserSummary
	for i := range list.Users {
		if list.Users[i].Username == "alice" {
			alice = &list.Users[i]
		}
	}
	if alice == nil {
		t.Fatalf("alice missing from list: %+v", list.Users)
	}
	if alice.Role != roleUser {
		t.Fatalf("new user role = %q, want user (admin must be explicit)", alice.Role)
	}
	if alice.DisabledAt != nil {
		t.Fatalf("new user disabled_at = %v, want nil", *alice.DisabledAt)
	}

	rec = postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "alice", Password: "password123"}, cookie)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate username = %d, want 409", rec.Code)
	}
}

// TestCreateUserRejectsWeakPassword proves the length floor is enforced
// server-side, not just in the UI.
func TestCreateUserRejectsWeakPassword(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	rec := postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "bob", Password: "short"}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("short password = %d, want 400", rec.Code)
	}
}

// TestDisableUserRevokesAccess proves disabling takes effect immediately --
// sessions are deleted and devices revoked, rather than lingering until they
// happen to expire.
func TestDisableUserRevokesAccess(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	rec := postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "carol", Password: "password123"}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	var carol apitypes.UserSummary
	decodeJSON(t, rec, &carol)

	// Give carol a live session and an active device.
	if _, err := db.Exec(
		`INSERT INTO sessions (id, user_id, expires_at) VALUES ('carol-sess', ?, '2099-01-01T00:00:00Z')`,
		carol.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(
		`INSERT INTO devices (id, owner_id, name, token_hash) VALUES ('carol-dev', ?, 'phone', 'hash-carol')`,
		carol.ID); err != nil {
		t.Fatal(err)
	}

	disabled := true
	rec = patchJSON(t, router, "/api/users/"+carol.ID, apitypes.UserPatch{Disabled: &disabled}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable = %d body=%s", rec.Code, rec.Body.String())
	}

	var sessions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, carol.ID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 0 {
		t.Fatalf("sessions after disable = %d, want 0", sessions)
	}
	var live int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM devices WHERE owner_id = ? AND revoked_at IS NULL`, carol.ID).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 0 {
		t.Fatalf("live devices after disable = %d, want 0", live)
	}
}

// TestLastAdminProtected proves the server cannot be left unadministrable
// through the UI by demoting, disabling or deleting the only admin.
func TestLastAdminProtected(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	var adminID string
	if err := db.QueryRow(`SELECT id FROM users WHERE role = 'admin'`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}

	role := roleUser
	rec := patchJSON(t, router, "/api/users/"+adminID, apitypes.UserPatch{Role: &role}, cookie)
	if rec.Code != http.StatusConflict {
		t.Fatalf("demote last admin = %d, want 409", rec.Code)
	}
	disabled := true
	rec = patchJSON(t, router, "/api/users/"+adminID, apitypes.UserPatch{Disabled: &disabled}, cookie)
	if rec.Code != http.StatusConflict {
		t.Fatalf("disable last admin = %d, want 409", rec.Code)
	}

	// With a second admin present, demotion is allowed again.
	rec = postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "admin2", Password: "password123", Role: roleAdmin}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second admin = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = patchJSON(t, router, "/api/users/"+adminID, apitypes.UserPatch{Role: &role}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("demote with a spare admin = %d body=%s, want 200", rec.Code, rec.Body.String())
	}
}

// TestDeleteUserRefusesWithAssets proves a library is never destroyed as a
// side effect of removing an account -- the purge must be opted into.
func TestDeleteUserRefusesWithAssets(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "b1", other)
	seedOwnedAssetFor(t, db, "b2", other)

	rec := deleteWithCookie(t, router, "/api/users/"+other, cookie)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete user owning assets = %d body=%s, want 409", rec.Code, rec.Body.String())
	}
	var blocked apitypes.UserDeleteBlocked
	decodeJSON(t, rec, &blocked)
	if blocked.AssetCount != 2 {
		t.Fatalf("asset_count = %d, want 2", blocked.AssetCount)
	}

	// The user and their assets must still be there.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM assets WHERE owner_id = ?`, other).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("assets after refused delete = %d, want 2", n)
	}
}

// TestDeleteUserPurgeRemovesLibrary proves the explicit purge does destroy
// the library, and only that user's.
func TestDeleteUserPurgeRemovesLibrary(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	seedOwnedAsset(t, db, "mine")
	other := secondOwner(t, db)
	seedOwnedAssetFor(t, db, "theirs", other)

	rec := deleteWithCookie(t, router, "/api/users/"+other+"?purge=true", cookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("purge delete = %d body=%s, want 204", rec.Code, rec.Body.String())
	}

	var theirs int
	if err := db.QueryRow(`SELECT COUNT(*) FROM assets WHERE owner_id = ?`, other).Scan(&theirs); err != nil {
		t.Fatal(err)
	}
	if theirs != 0 {
		t.Fatalf("purged user's assets = %d, want 0", theirs)
	}
	// The caller's own library is untouched.
	var mine int
	if err := db.QueryRow(`SELECT COUNT(*) FROM assets WHERE id = 'mine'`).Scan(&mine); err != nil {
		t.Fatal(err)
	}
	if mine != 1 {
		t.Fatalf("caller's own asset survived = %d, want 1", mine)
	}
	var users int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, other).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 0 {
		t.Fatalf("user rows after delete = %d, want 0", users)
	}
}

// TestDeleteSelfRefused proves an admin cannot delete their own account out
// from under themselves.
//
// A second admin is created first, and the assertion is on the error code
// rather than the status. Otherwise the last-admin guard also returns 409 and
// the test passes whether or not the self-delete guard exists at all.
func TestDeleteSelfRefused(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	var adminID string
	if err := db.QueryRow(`SELECT id FROM users WHERE role = 'admin'`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	rec := postJSON(t, router, "/api/users",
		apitypes.UserCreate{Username: "admin2", Password: "password123", Role: roleAdmin}, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create spare admin = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = deleteWithCookie(t, router, "/api/users/"+adminID, cookie)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete self = %d, want 409", rec.Code)
	}
	var body apitypes.Error
	decodeJSON(t, rec, &body)
	if body.Error != "cannot_delete_self" {
		t.Fatalf("delete self error = %q, want cannot_delete_self", body.Error)
	}

	// The account must still exist.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, adminID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("admin deleted themselves: rows = %d, want 1", n)
	}
}

// TestDisabledUserCannotAuthenticate proves disabling actually blocks access,
// not merely new logins: an existing session stops resolving.
func TestDisabledUserCannotAuthenticate(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	// The caller is the only admin, so disable via SQL rather than the API
	// (which correctly refuses to strand the last admin).
	if _, err := db.Exec(`UPDATE users SET disabled_at = '2026-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	rec := getRawWithCookie(t, router, "/api/assets", cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("disabled user's session = %d, want 401", rec.Code)
	}
}
