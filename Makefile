# Kuraki — developer shortcuts
# Run `make help` for the list.

BINARY      := kuraki
CMD         := ./cmd/kuraki
BIN_DIR     := bin
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X main.version=$(VERSION)
IMAGE       := ghcr.io/kuraki-app/kuraki
# Expo dependencies occasionally contain Go fixtures. They are not part of
# Kuraki's module and must not become accidental Go test/vet packages.
GO_PACKAGES := $(shell go list ./... | grep -v '/node_modules/')

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: ## Build the pure-Go binary into ./bin
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) $(CMD)

.PHONY: build-vips
build-vips: ## Build with the libvips backend (needs libvips-dev)
	CGO_ENABLED=1 go build -trimpath -tags vips -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) $(CMD)

.PHONY: run
run: build ## Build and start the server
	$(BIN_DIR)/$(BINARY) serve

.PHONY: start
start: ## Build web + binary and run one production-like server (scripts/start.sh)
	./scripts/start.sh

.PHONY: dev
dev: ## Run API (:3000) + Vite UI (:5173) separately with hot reload (scripts/dev.sh)
	./scripts/dev.sh

.PHONY: web
web: ## Build SvelteKit UI into embedded assets
	cd web && npm run build

.PHONY: e2e
e2e: web build ## Browser end-to-end suite (Playwright) against a real seeded server
	cd web && npm run test:e2e

.PHONY: test
test: ## Run tests with the race detector
	go test -race $(GO_PACKAGES)

.PHONY: vet
vet: ## Run go vet
	go vet $(GO_PACKAGES)

.PHONY: fmt
fmt: ## Format all Go code
	gofmt -w -s .

.PHONY: tidy
tidy: ## Tidy go.mod / go.sum
	go mod tidy

.PHONY: check
check: fmt vet test ## Format, vet, and test

.PHONY: docker
docker: ## Build the Docker image
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

.PHONY: cross
cross: ## Cross-compile release binaries into ./dist
	@mkdir -p dist
	@for t in linux/amd64 linux/arm64 darwin/arm64 windows/amd64; do \
		os=$${t%/*}; arch=$${t#*/}; out=dist/$(BINARY)-$$os-$$arch; \
		[ "$$os" = "windows" ] && out=$$out.exe; \
		echo "building $$out"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o $$out $(CMD); \
	done

# Generator versions are pinned: `make check-gen` diffs regenerated output against
# what is committed, so an unpinned generator would fail the gate spuriously.
SWAG_VERSION := v1.16.4
SWAG         := go run github.com/swaggo/swag/cmd/swag@$(SWAG_VERSION)
S2O_VERSION  := 7.0.8
OAPI_TS_VER  := 7.4.4

.PHONY: openapi
openapi: ## Regenerate the OpenAPI contract from the Go handlers
	@tmp=$$(mktemp -d); \
	trap 'rm -rf "$$tmp"' EXIT; \
	$(SWAG) init --dir ./cmd/kuraki,./internal/httpapi --parseInternal \
		--output "$$tmp" --outputTypes json; \
	npx -y swagger2openapi@$(S2O_VERSION) "$$tmp/swagger.json" -o internal/httpapi/apispec/openapi.json

.PHONY: client-types
client-types: ## Regenerate web + mobile TS types from the contract
	npx -y openapi-typescript@$(OAPI_TS_VER) internal/httpapi/apispec/openapi.json -o web/src/lib/api.gen.ts
	npx -y openapi-typescript@$(OAPI_TS_VER) internal/httpapi/apispec/openapi.json -o mobile/src/lib/api.gen.ts

.PHONY: gen
gen: openapi client-types ## Regenerate the contract and all client types

GEN_ARTIFACTS := internal/httpapi/apispec/openapi.json web/src/lib/api.gen.ts mobile/src/lib/api.gen.ts

.PHONY: check-gen
check-gen: gen ## Fail if the committed contract/client types are stale (CI gate)
	@git diff --exit-code -- $(GEN_ARTIFACTS) || { \
		echo; \
		echo "ERROR: generated API contract is out of date."; \
		echo "You changed the Go handlers or apitypes without regenerating."; \
		echo "Run 'make gen' and commit the result."; \
		exit 1; \
	}

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf $(BIN_DIR) dist
