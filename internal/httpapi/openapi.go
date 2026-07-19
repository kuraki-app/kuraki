package httpapi

import (
	"net/http"

	"github.com/kuraki-app/kuraki/internal/httpapi/apispec"
)

// serveOpenAPI serves the embedded OpenAPI contract. Public: it is a schema,
// not data, so tooling and clients can fetch the contract without auth.
func (d Deps) serveOpenAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(apispec.OpenAPIJSON)
}
