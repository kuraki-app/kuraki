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

func TestOpenAPICoreSchemasAndPaths(t *testing.T) {
	var doc struct {
		Paths      map[string]any `json:"paths"`
		Components struct {
			Schemas map[string]any `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(OpenAPIJSON, &doc); err != nil {
		t.Fatalf("spec is not valid JSON: %v", err)
	}
	for _, s := range []string{"apitypes.Asset", "apitypes.AssetList", "apitypes.Error"} {
		if _, ok := doc.Components.Schemas[s]; !ok {
			t.Errorf("spec missing schema %s", s)
		}
	}
	for _, p := range []string{"/api/assets", "/api/search", "/api/albums"} {
		if _, ok := doc.Paths[p]; !ok {
			t.Errorf("spec missing path %s", p)
		}
	}
}
