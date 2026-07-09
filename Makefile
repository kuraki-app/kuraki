# Kuraki — developer shortcuts
# Run `make help` for the list.

BINARY      := kuraki
CMD         := ./cmd/kuraki
BIN_DIR     := bin
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X main.version=$(VERSION)
IMAGE       := ghcr.io/kuraki-app/kuraki

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

.PHONY: web
web: ## Build SvelteKit UI into embedded assets
	cd web && npm run build

.PHONY: test
test: ## Run tests with the race detector
	go test -race ./...

.PHONY: vet
vet: ## Run go vet
	go vet ./...

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

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf $(BIN_DIR) dist
