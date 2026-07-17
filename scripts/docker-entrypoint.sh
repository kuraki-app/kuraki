#!/usr/bin/env bash
#
# Kuraki container entrypoint.
#
# Default (no args, or `serve`): run BOTH surfaces in one container —
#   • Go API server (kuraki serve) on :3000  — /api, media, /healthz, /metrics
#   • Caddy static server          on :8080  — the SvelteKit UI, proxying the
#                                              API paths back to :3000
#
# Any other argument (version, import, verify, healthcheck, backup, …) is
# forwarded straight to the kuraki CLI, so `docker run … version`,
# `docker compose exec kuraki kuraki import /inbox`, and the container
# HEALTHCHECK (`kuraki healthcheck`) all keep working unchanged.
set -euo pipefail

# Non-serve CLI invocations pass straight through to the binary.
if [ "$#" -gt 0 ] && [ "$1" != "serve" ]; then
	exec kuraki "$@"
fi
# Drop a leading `serve`; any remaining args are forwarded to `kuraki serve`.
[ "${1:-}" = "serve" ] && shift

term() {
	trap - TERM INT
	kill -TERM "${KURAKI_PID:-}" "${CADDY_PID:-}" 2>/dev/null || true
}
trap term TERM INT

kuraki serve "$@" &
KURAKI_PID=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# If either server exits, tear the whole container down so the orchestrator's
# restart policy can react — a half-up container (API without UI, or the
# reverse) is worse than a clean restart.
wait -n
status=$?
term
wait 2>/dev/null || true
exit "$status"
