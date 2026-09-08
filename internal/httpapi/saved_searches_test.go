package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// A saved search has to survive the round trip through SQLite.
//
// It did not. query_json is TEXT and apitypes.SavedSearch.Query is a
// json.RawMessage; database/sql matches its []byte scan destinations by exact
// type, so the named type fell through to "unsupported Scan, storing
// driver.Value type string into type *json.RawMessage" and GET
// /api/saved-searches answered 500 from the moment the first search was saved
// until it was deleted out of the database by hand. The web UI swallows the
// failure and renders "No saved searches yet", so the feature looked empty
// rather than broken. Nothing covered the pair — creating and listing were
// each exercised only against an empty table.
func TestSavedSearchRoundTrip(t *testing.T) {
	router, _ := newAuthTestRouter(t)
	cookie := setupTestSession(t, router)

	empty := getJSON(t, router, "/api/saved-searches", cookie)
	if empty.Code != http.StatusOK {
		t.Fatalf("empty list = %d body = %s", empty.Code, empty.Body.String())
	}

	created := postJSON(t, router, "/api/saved-searches", apitypes.SavedSearchRequest{
		Name:  "Nikon",
		Query: json.RawMessage(`{"camera":"Nikon D800E"}`),
	}, cookie)
	if created.Code != http.StatusCreated {
		t.Fatalf("create = %d body = %s", created.Code, created.Body.String())
	}
	var one apitypes.SavedSearch
	if err := json.Unmarshal(created.Body.Bytes(), &one); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	// created_at is declared required; it was returned empty because the
	// response was built from the request rather than from the row.
	if one.CreatedAt == "" {
		t.Error("create response carries no created_at")
	}

	rec := getJSON(t, router, "/api/saved-searches", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("list after create = %d body = %s", rec.Code, rec.Body.String())
	}
	var list apitypes.SavedSearchList
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.SavedSearches) != 1 {
		t.Fatalf("listed %d saved searches, want 1", len(list.SavedSearches))
	}
	got := list.SavedSearches[0]
	if got.Name != "Nikon" {
		t.Errorf("name = %q, want Nikon", got.Name)
	}
	// The query must come back as the JSON object it went in as, not as a
	// quoted string or an empty value.
	var query map[string]string
	if err := json.Unmarshal(got.Query, &query); err != nil {
		t.Fatalf("query did not round-trip as JSON (%s): %v", got.Query, err)
	}
	if query["camera"] != "Nikon D800E" {
		t.Errorf("query = %v, want camera Nikon D800E", query)
	}
	if got.CreatedAt != one.CreatedAt {
		t.Errorf("created_at differs between create (%q) and list (%q)", one.CreatedAt, got.CreatedAt)
	}
}
