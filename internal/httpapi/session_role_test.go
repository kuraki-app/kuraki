package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// The user a client is handed at sign-in must carry the same role GET /api/me
// reports.
//
// It did not: /api/setup and /api/login both built the response from the
// request rather than from the row, so `role` — declared required — came back
// empty, and a client that stores the sign-in user and gates admin surfaces on
// it saw every admin as an ordinary account until the next reload of /api/me.
func TestSignInResponsesCarryRole(t *testing.T) {
	router, _ := newAuthTestRouter(t)

	setupRec := postJSON(t, router, "/api/setup",
		apitypes.Credentials{Username: "saransh", Password: "correct horse"}, nil)
	if setupRec.Code != http.StatusCreated {
		t.Fatalf("setup = %d body = %s", setupRec.Code, setupRec.Body.String())
	}
	if got := decodeUser(t, setupRec.Body.Bytes()).Role; got != roleAdmin {
		t.Errorf("setup response role = %q, want %q", got, roleAdmin)
	}

	loginRec := postJSON(t, router, "/api/login",
		apitypes.Credentials{Username: "saransh", Password: "correct horse"}, nil)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login = %d body = %s", loginRec.Code, loginRec.Body.String())
	}
	login := decodeUser(t, loginRec.Body.Bytes())
	if login.Role != roleAdmin {
		t.Errorf("login response role = %q, want %q", login.Role, roleAdmin)
	}

	// And it must agree with the endpoint the client would otherwise have to
	// call to find out.
	cookie := findCookie(loginRec.Result().Cookies(), sessionCookieName)
	me := decodeUser(t, getJSON(t, router, "/api/me", cookie).Body.Bytes())
	if me.Role != login.Role {
		t.Errorf("/api/me role = %q but login said %q", me.Role, login.Role)
	}
}

func decodeUser(t *testing.T, body []byte) apitypes.User {
	t.Helper()
	var status apitypes.SetupStatus
	if err := json.Unmarshal(body, &status); err != nil {
		t.Fatalf("decode setup status: %v", err)
	}
	if status.User == nil {
		t.Fatal("response carries no user")
	}
	return *status.User
}
