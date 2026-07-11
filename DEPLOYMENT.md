# Deploying Kuraki in production

Kuraki serves plain HTTP and is designed to run **behind a reverse proxy that
terminates TLS**. It deliberately has no built-in certificate handling: a proxy
(Caddy, nginx, Traefik, a cloud load balancer) does that job better and is
already part of most self-hosted stacks. This guide covers a known-good setup
and the handful of settings that matter for a safe production deployment.

## TL;DR

- Put Kuraki behind a proxy that does HTTPS. Do **not** expose plain HTTP to the
  internet.
- Behind that proxy set **`KURAKI_SECURE_COOKIES=1`** and **`KURAKI_TRUST_PROXY=1`**.
- Turn on **`KURAKI_BACKUP_DIR`** pointing at a **separate disk** from your library.
- The ready-to-run stack is [`deploy/docker-compose.caddy.yml`](deploy/docker-compose.caddy.yml)
  + [`deploy/Caddyfile`](deploy/Caddyfile) — automatic Let's Encrypt HTTPS in ~4 steps.

## Quick start (Caddy, automatic HTTPS)

Caddy fetches and renews a certificate for your domain and reverse-proxies to
Kuraki over a private Docker network; Kuraki is never published on a host port.

1. Point an `A`/`AAAA` DNS record for `photos.example.com` at the host.
2. Edit [`deploy/Caddyfile`](deploy/Caddyfile) — replace `photos.example.com` with your domain.
3. In [`deploy/docker-compose.caddy.yml`](deploy/docker-compose.caddy.yml), adjust the
   `kuraki-data` and backup mount paths.
4. Start it:
   ```bash
   docker compose -f deploy/docker-compose.caddy.yml up -d
   ```
5. Open `https://photos.example.com` and create the owner account.

## The two settings that matter behind a proxy

These are **off by default** because the safe default for a directly-exposed
server is the opposite. Once a proxy is terminating TLS in front of Kuraki, both
should be on.

### `KURAKI_SECURE_COOKIES=1`
Marks the session cookie `Secure` so browsers only send it over HTTPS. Without a
proxy doing TLS there is no HTTPS to gate on, which is why it defaults off — but
in production it should always be on so the session cookie can never leak over a
plaintext request.

### `KURAKI_TRUST_PROXY=1`
Makes Kuraki read the client IP from the proxy's `X-Forwarded-For` / `X-Real-IP`
header instead of the TCP peer (which, behind a proxy, is always the proxy).

**This is the setting to get right.** The per-IP throttles on login and device
pairing are a real defence against brute force. If you enable `TRUST_PROXY`
while Kuraki is *also* reachable directly (e.g. a published host port), a client
can send a forged `X-Forwarded-For` and make every request look like a different
IP — defeating the rate limit entirely.

The rule:

| Situation | `KURAKI_TRUST_PROXY` |
|---|---|
| Behind a proxy that sets `X-Forwarded-For`, **and** Kuraki is not reachable except through it | `1` |
| Kuraki is directly exposed (published port, no proxy) | `0` (leave off) |
| Behind a proxy **but** the container port is also published to the host/LAN | `0`, or stop publishing the port |

In the Caddy compose above, Kuraki uses `expose:` (internal network only), not
`ports:`, so the only path to it is through Caddy — which is exactly what makes
`TRUST_PROXY=1` safe.

## Backups

Turn on unattended backups and keep them off the library disk:

```yaml
environment:
  KURAKI_BACKUP_DIR: /backups          # a separate disk/mount, not inside /data
  KURAKI_BACKUP_INTERVAL_HOURS: "24"   # default
  KURAKI_BACKUP_KEEP: "7"              # default; older archives are pruned
```

Each run writes a SQLite-consistent `kuraki-backup-<timestamp>.tar.gz`. The
Library dashboard shows the last backup's age and outcome and flags an overdue
or failed one. A backup on the same disk as the library protects against
accidental deletion but not disk failure — mount `KURAKI_BACKUP_DIR` on
different hardware (or sync it off-site) for real durability.

Restore on a clean machine with:

```bash
kuraki restore kuraki-backup-<timestamp>.tar.gz --data-dir /data
```

## Monitoring

- `GET /healthz` — public liveness probe (also used by the container healthcheck).
- `GET /metrics` — memory, goroutines, uptime, and library counts. Requires an
  owner session, or an `Authorization: Bearer <KURAKI_METRICS_TOKEN>` header for
  a scraper. Set `KURAKI_METRICS_TOKEN` to a long random string to let Prometheus
  or similar read it without a browser session.

## Account recovery

If you are locked out of the owner account, reset the password offline against
the library — no web access needed:

```bash
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki passwd --username owner --data-dir /data
```

It prompts for a new password (or reads it from piped stdin) and signs out every
existing session.

## nginx alternative

If you already run nginx, terminate TLS there and proxy to Kuraki. Keep Kuraki
on the internal network only (no published host port) so `TRUST_PROXY` stays
safe.

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;

    ssl_certificate     /etc/letsencrypt/live/photos.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/photos.example.com/privkey.pem;

    # Photo/video originals are large.
    client_max_body_size 2G;

    location / {
        proxy_pass         http://kuraki:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_request_buffering off;   # stream large uploads
    }
}
```

With any proxy, the invariant is the same: **Kuraki reachable only through the
proxy**, `KURAKI_TRUST_PROXY=1`, `KURAKI_SECURE_COOKIES=1`.
