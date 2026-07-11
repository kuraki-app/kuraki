#!/usr/bin/env bash
#
# start.sh — build the web UI, embed it, and run the server and website TOGETHER
# as a single production-like process on one port.
#
#   1. Build the SvelteKit UI into internal/httpapi/assets  (embedded via go:embed)
#   2. Build the Go binary  -> ./bin/kuraki
#   3. Run it               -> http://localhost:3000  (UI + API from one process)
#
# This is the "just run it from source" path — no Node process stays running,
# the compiled UI is served straight from the binary, exactly as in production.
# For hot-reloading development with the UI and API split across two processes,
# use scripts/dev.sh instead. For containerised deployment, use Docker
# (docker compose up -d) — see DEPLOYMENT.md.
#
# Usage:  ./scripts/start.sh
# Any arguments are forwarded to `kuraki serve` (e.g. --addr :4000 --data-dir …).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not installed." >&2; exit 1; }; }
need go
need node
need npm

echo "==> [1/3] Building web UI (embedded assets)…"
if [ ! -d web/node_modules ]; then
  (cd web && npm ci)
fi
(cd web && npm run build)

echo "==> [2/3] Building Go binary -> ./bin/kuraki …"
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o bin/kuraki ./cmd/kuraki

echo "==> [3/3] Starting Kuraki on http://localhost:3000 (Ctrl-C to stop)…"
echo ""
exec ./bin/kuraki serve "$@"
