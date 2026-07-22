#!/usr/bin/env bash
#
# Kuraki container entrypoint.
#
# Default (no args, or `serve`): run `kuraki serve` on :3000 — one process that
# serves the API, media, and the embedded SvelteKit UI (including first-run
# setup) from a single origin.
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

# exec so kuraki is PID 1: it receives SIGTERM directly for a clean shutdown,
# and the orchestrator's restart policy reacts to its exit.
exec kuraki serve "$@"
