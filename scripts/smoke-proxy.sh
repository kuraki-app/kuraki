#!/usr/bin/env bash
# Check the shipped private proxy topology with an isolated internal TLS CA.
set -euo pipefail
image=${1:?usage: scripts/smoke-proxy.sh IMAGE}
image=$(docker image inspect --format '{{.Id}}' "$image")
task_dir=$(mktemp -d)
prefix="kuraki-tls-$(date +%s)-$$"
app="${prefix}-app"
proxy="${prefix}-proxy"
network="${prefix}-network"
cleanup() {
  docker rm -f "$app" "$proxy" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$task_dir"
}
trap cleanup EXIT
docker network create "$network" >/dev/null
cat > "$task_dir/Caddyfile" <<EOF
{
  admin off
}
https://kuraki-proof.test {
  tls internal
  reverse_proxy $app:39170 {
    header_up -True-Client-IP
    header_up -X-Real-IP
  }
}
EOF
docker run -d --rm --name "$app" --network "$network" \
  -e KURAKI_SECURE_COOKIES=1 -e KURAKI_TRUST_PROXY=1 \
  -e KURAKI_PUBLIC_URL=https://kuraki-proof.test "$image" >/dev/null
docker run -d --rm --name "$proxy" --network "$network" \
  -p 127.0.0.1::443 -v "$task_dir/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 >/dev/null
port=$(docker port "$proxy" 443/tcp | head -1)
port=${port##*:}
origin="https://kuraki-proof.test:$port"
tls_curl() { curl -sk --noproxy '*' --resolve "kuraki-proof.test:$port:127.0.0.1" "$@"; }
ready=0
for _ in $(seq 1 60); do
  if tls_curl -f "$origin/healthz" >/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { docker logs "$app"; docker logs "$proxy"; exit 1; }
tls_curl -f -D "$task_dir/headers" -c "$task_dir/cookies" -H 'Content-Type: application/json' \
  -d '{"username":"tls-proof","password":"tls-proof-password"}' "$origin/api/setup" >/dev/null
grep -qi '^set-cookie:.*Secure' "$task_dir/headers"
grep -qi '^strict-transport-security:' "$task_dir/headers"
tls_curl -f -b "$task_dir/cookies" "$origin/api/me" >/dev/null
# Alternate client-IP headers and an incoming forwarding chain must not create
# fresh rate-limit buckets outside the trusted proxy's canonical client address.
for attempt in $(seq 1 11); do
  code=$(tls_curl -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -H "True-Client-IP: 198.51.100.$attempt" -H "X-Real-IP: 192.0.2.$attempt" \
    -H "X-Forwarded-For: 203.0.113.$attempt" \
    -d '{"username":"unknown-account","password":"wrong-password"}' "$origin/api/login")
  if [ "$attempt" -le 10 ]; then [ "$code" = 401 ]; else [ "$code" = 429 ]; fi
done
printf 'PASS TLS/secure-cookie/HSTS/private-proxy/forwarded-header throttling\n'
