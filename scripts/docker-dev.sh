#!/usr/bin/env bash
#
# docker-dev.sh — build the Kuraki image FROM THIS WORKING TREE and (re)create
# the local container on it.
#
# Why this exists: the web UI is compiled into the Go binary with go:embed, so a
# container running a published image (ghcr.io/kuraki-app/kuraki:latest) can
# never show a local change, no matter how many times the web assets are
# rebuilt. Seeing your own edits on :3000 means rebuilding the image and
# recreating the container — the two steps this script does.
#
#   1. docker build -t kuraki:local .   (the Dockerfile builds the SPA itself)
#   2. replace the container, same port / bind mount / restart policy
#   3. wait for the HEALTHCHECK, then print the address to pair a phone against
#
# The library lives in a host bind mount (KURAKI_DATA_DIR below), so recreating
# the container never touches your photos or database.
#
# Usage:
#   ./scripts/docker-dev.sh                 # build from source, then recreate
#   ./scripts/docker-dev.sh --no-build      # recreate on the existing image
#   ./scripts/docker-dev.sh --published     # go back to the published image
#
# Overridable:  IMAGE, CONTAINER, PORT, KURAKI_DATA_DIR
#
# For running from source without Docker, use scripts/start.sh; for hot-reload
# development, scripts/dev.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not installed." >&2; exit 1; }; }
need docker

IMAGE="${IMAGE:-kuraki:local}"
PUBLISHED_IMAGE="ghcr.io/kuraki-app/kuraki:latest"
CONTAINER="${CONTAINER:-kuraki}"
PORT="${PORT:-3000}"
DATA_DIR="${KURAKI_DATA_DIR:-$ROOT/kuraki-data}"

build=1
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --published) build=0; IMAGE="$PUBLISHED_IMAGE" ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument '$arg' (try --help)" >&2; exit 1 ;;
  esac
done

# The address to hand a phone. A pairing QR generated from localhost embeds
# "localhost", which on a phone means the phone itself — so print the address
# that actually reaches this machine and let the operator use that one.
lan_ip() {
  local iface
  if command -v ipconfig >/dev/null 2>&1; then
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    if [ -n "$iface" ]; then
      ipconfig getifaddr "$iface" 2>/dev/null && return 0
    fi
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}'
  fi
}

if [ "$build" -eq 1 ]; then
  echo "==> Building ${IMAGE} from source (this rebuilds the embedded UI)..."
  docker build -t "$IMAGE" .
else
  echo "==> Skipping build; using $IMAGE as-is."
fi

mkdir -p "$DATA_DIR"

exists() { [ -n "$(docker ps -aq -f "name=^${1}\$")" ]; }

# A container is a disposable wrapper around an image: updating the embedded UI
# means a new image, and a container cannot swap its image in place. So the
# update is a replacement — but only ever when the image actually changed, and
# never by destroying the working container before the new one has proven
# itself. An interrupted run must not be able to leave this machine with no
# Kuraki at all (which is exactly what an earlier version of this script did).
# --published (or --no-build on a clean machine) can name an image that is not
# here yet; pull it before anything else, so a missing image can never be
# discovered halfway through the swap.
if ! target_id="$(docker image inspect --format '{{.Id}}' "${IMAGE}" 2>/dev/null)"; then
  echo "==> Image ${IMAGE} is not present locally; pulling..."
  docker pull "${IMAGE}"
  target_id="$(docker image inspect --format '{{.Id}}' "${IMAGE}")"
fi
current_id=""
running="false"
if exists "${CONTAINER}"; then
  current_id="$(docker inspect --format '{{.Image}}' "${CONTAINER}" 2>/dev/null || echo '')"
  running="$(docker inspect --format '{{.State.Running}}' "${CONTAINER}" 2>/dev/null || echo false)"
fi

if [ "${current_id}" = "${target_id}" ] && [ "${running}" = "true" ]; then
  echo "==> '${CONTAINER}' is already running ${IMAGE} - container left untouched."
else
  PREV="${CONTAINER}_prev"
  exists "${PREV}" && docker rm -f "${PREV}" >/dev/null # stale rollback from an interrupted run

  had_previous=0
  if exists "${CONTAINER}"; then
    had_previous=1
    echo "==> Parking the current container as '${PREV}' (kept until the new one is healthy)..."
    docker stop "${CONTAINER}" >/dev/null # frees the port; the container itself is preserved
    docker rename "${CONTAINER}" "${PREV}"
  fi

  rollback() {
    [ "${had_previous}" -eq 1 ] || return 0
    echo "==> Rolling back to the previous container..." >&2
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    docker rename "${PREV}" "${CONTAINER}" >/dev/null 2>&1 || return 0
    docker start "${CONTAINER}" >/dev/null 2>&1 || true
  }

  fail() {
    echo "" >&2
    echo "error: $1" >&2
    docker logs --tail 40 "${CONTAINER}" >&2 2>/dev/null || true
    rollback
    exit 1
  }

  echo "==> Starting '${CONTAINER}' on port ${PORT}..."
  # KURAKI_DATA_DIR / KURAKI_ADDR / KURAKI_ANDROID_APK are ENV defaults baked
  # into the image, so they are deliberately not repeated here.
  docker run -d \
    --name "${CONTAINER}" \
    --restart unless-stopped \
    -p "${PORT}:3000" \
    -v "${DATA_DIR}:/data" \
    "${IMAGE}" >/dev/null || fail "could not start the new container."

  # The image ships a HEALTHCHECK (kuraki healthcheck). Wait on it rather than
  # sleeping a fixed amount, so a broken build is caught while rollback is still
  # possible.
  printf '==> Waiting for the container to report healthy'
  health="starting"
  for _ in $(seq 1 60); do
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER}" 2>/dev/null || echo gone)"
    case "${health}" in
      healthy) echo " - healthy." ; break ;;
      none)    echo " - no healthcheck in this image; assuming up." ; break ;;
      gone|unhealthy) fail "container reported '${health}'. Recent logs:" ;;
    esac
    printf '.'
    sleep 1
  done
  case "${health}" in
    healthy|none) ;;
    *) fail "container did not become healthy within 60s. Recent logs:" ;;
  esac

  if [ "${had_previous}" -eq 1 ]; then
    docker rm "${PREV}" >/dev/null
    echo "==> New container is healthy; the parked one has been discarded."
  fi
fi

ip="$(lan_ip || true)"
echo ""
echo "  Kuraki is running from $IMAGE"
echo "  Data dir : $DATA_DIR"
if [ -n "$ip" ]; then
  echo "  Open     : http://${ip}:${PORT}   <- use THIS to pair a phone"
  echo "             (http://localhost:${PORT} works in a browser, but a pairing"
  echo "              code generated there points a phone at itself)"
else
  echo "  Open     : http://localhost:${PORT}"
  echo "  note: could not detect a LAN address - pair using this machine's"
  echo "        network address, not localhost."
fi
echo ""
echo "  Logs   : docker logs -f $CONTAINER"
echo "  Revert : ./scripts/docker-dev.sh --published"
