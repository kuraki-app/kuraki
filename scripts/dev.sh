#!/usr/bin/env bash
#
# dev.sh — run Kuraki's backend and frontend as SEPARATE processes for local
# development, with hot-reloading.
#
#   • Go API server              -> http://localhost:3000  (serves /api, media)
#   • Vite dev server (SvelteKit) -> http://localhost:5173  (open THIS one)
#
# Vite proxies /api, /healthz, and /metrics to the Go server (see
# web/vite.config.ts), so the UI hot-reloads on save while talking to the real
# backend. Both processes stop together on Ctrl-C.
#
# For a single production-like process instead (built UI embedded in one binary
# on one port), use scripts/start.sh.
#
# Usage:  ./scripts/dev.sh
# Any arguments are forwarded to `kuraki serve` (e.g. --addr :4000 --data-dir …).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not installed." >&2; exit 1; }; }
need go
need node
need npm

if [ ! -d web/node_modules ]; then
  echo "==> Installing web dependencies (first run)…"
  (cd web && npm install)
fi

# `go run` and `npm` each spawn a deeper child (the compiled server, the vite
# process), so killing only the launcher leaves the real listener holding its
# port. kill_tree walks all descendants with `pgrep -P` and kills the subtree.
# We SIGKILL for an instant dev teardown — the server's 15s graceful-shutdown
# window is unwanted here and would keep the port busy for the next run.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "==> Shutting down…"
  # Root at this script so every descendant (go run→server, npm→vite→esbuild)
  # is caught regardless of how the tree was reparented.
  for child in $(pgrep -P $$ 2>/dev/null); do
    kill_tree "$child"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "==> Starting Go API server on :3000…"
go run ./cmd/kuraki serve "$@" &
api_pid=$!

echo "==> Starting Vite dev server on :5173…"
(cd web && npm run dev) &
ui_pid=$!

echo ""
echo "  Backend : http://localhost:3000"
echo "  Frontend: http://localhost:5173   <- open this one"
echo "  Press Ctrl-C to stop both."
echo ""

# Wait until either process exits, then cleanup (via the EXIT trap) stops the
# other. `wait -n` isn't in bash 3.2 (macOS default), so poll portably.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do
  sleep 1
done
