// Package apispec holds the committed OpenAPI contract, embedded into the
// binary so the running server can advertise its own API contract.
package apispec

import _ "embed"

// OpenAPIJSON is the OpenAPI 3.0 document describing the Kuraki HTTP API.
// It is generated from the Go handlers (see `make gen`) and committed; the
// CI contract job regenerates it and fails on any diff.
//
//go:embed openapi.json
var OpenAPIJSON []byte
