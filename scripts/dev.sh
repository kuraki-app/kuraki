#!/usr/bin/env bash
#
# dev.sh — run Kuraki's backend and frontend as SEPARATE processes for local
# development, with hot-reloading.
#
#   • Go API server              -> http://localhost:$KURAKI_PORT      (serves /api, media)
#   • Vite dev server (SvelteKit) -> http://localhost:$KURAKI_WEB_PORT  (open THIS one)
#
# Vite proxies the server-owned paths to the Go server (see web/vite.config.ts),
# so the UI hot-reloads on save while talking to the real backend. Both
# processes stop together on Ctrl-C.
#
# Both ports come from ports.env (generated from internal/config/ports.go) and
# are exported, so web/vite.config.ts proxies to the same number this script
# started the server on. Passing `--addr` directly would move the server without
# moving the proxy, and the UI would then quietly talk to whatever else is there.
#
# They are deliberately NOT the server's shipped default, so a hot-reload
# session cannot collide with a separately deployed production service.
#
# For a single production-like process instead (built UI embedded in one binary
# on one port), use scripts/start.sh.
#
# Usage:  ./scripts/dev.sh
#         KURAKI_PORT=4000 ./scripts/dev.sh
# Any arguments are forwarded to `kuraki serve` (e.g. --data-dir …).
set -euo pipefail

# Ports come from ports.env, which `make ports` generates from
# internal/config/ports.go — the Go server owns the numbers, everything else
# reads them. Sourced before ROOT is computed, so resolve the path directly.
# Existing environment wins, so `KURAKI_PORT=4000 ./scripts/dev.sh` still works.
_ports="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ports.env"
if [ -f "$_ports" ]; then
  while IFS='=' read -r _k _v; do
    case "$_k" in ''|\#*) continue ;; esac
    # `-v` so anything already exported on the command line takes precedence.
    if [ -z "${!_k-}" ]; then export "$_k=$_v"; fi
  done < "$_ports"
fi
export KURAKI_PORT="${KURAKI_PORT:-39175}"
export KURAKI_WEB_PORT="${KURAKI_WEB_PORT:-39176}"

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

# --addr would move the server and leave the proxy behind, which is the exact
# failure this script now exists to prevent. Name the alternative instead of
# silently overriding it.
for arg in "$@"; do
  case "$arg" in
    --addr|--addr=*)
      echo "Use KURAKI_PORT instead of --addr here, so Vite's proxy moves with the server:" >&2
      echo "  KURAKI_PORT=39185 ./scripts/dev.sh" >&2
      exit 1
      ;;
  esac
done

# Fail before starting anything if the port is taken. Otherwise the Go server
# exits on `bind: address already in use` a second after Vite prints its banner,
# the two messages interleave, and the whole session dies with the cause already
# scrolled past — or worse, on a machine where something else owns 3000, the
# proxy keeps working and serves that other app's responses into the Kuraki UI.
if holder="$(lsof -nP -iTCP:"$KURAKI_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}')" && [ -n "$holder" ]; then
  echo "Port $KURAKI_PORT is already in use by $holder." >&2
  echo "Stop it, or pick another:  KURAKI_PORT=39185 ./scripts/dev.sh" >&2
  exit 1
fi

echo "==> Starting Go API server on :${KURAKI_PORT}…"
go run ./cmd/kuraki serve --addr ":$KURAKI_PORT" "$@" &
api_pid=$!

echo "==> Starting Vite dev server on :${KURAKI_WEB_PORT}…"
(cd web && npm run dev) &
ui_pid=$!

echo ""
echo "  Backend : http://localhost:$KURAKI_PORT"
echo "  Frontend: http://localhost:$KURAKI_WEB_PORT   <- open this one"
echo "  Press Ctrl-C to stop both."
echo ""

# Wait until either process exits, then cleanup (via the EXIT trap) stops the
# other. `wait -n` isn't in bash 3.2 (macOS default), so poll portably.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do
  sleep 1
done
