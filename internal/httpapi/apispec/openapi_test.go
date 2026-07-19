package apispec

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenAPISpecEmbedded(t *testing.T) {
	if len(OpenAPIJSON) == 0 {
		t.Fatal("openapi.json is empty — run `make gen`")
	}
	var doc struct {
		OpenAPI string                     `json:"openapi"`
		Paths   map[string]any             `json:"paths"`
		Comps   map[string]json.RawMessage `json:"components"`
	}
	if err := json.Unmarshal(OpenAPIJSON, &doc); err != nil {
		t.Fatalf("spec is not valid JSON: %v", err)
	}
	if !strings.HasPrefix(doc.OpenAPI, "3.") {
		t.Fatalf("openapi = %q, want 3.x", doc.OpenAPI)
	}
	if _, ok := doc.Paths["/api/status"]; !ok {
		t.Fatal("spec missing /api/status path")
	}
}
