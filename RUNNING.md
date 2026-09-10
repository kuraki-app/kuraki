# Running Kuraki

This is the operator runbook for running Kuraki directly from source during
local development and deploying released builds with Docker. Kuraki is one Go
server: in a production build it serves the API, media, and embedded SvelteKit
web UI from the same address.

For application behavior after it is running, see [USER_GUIDE.md](USER_GUIDE.md).
For the shorter security-focused deployment reference, see
[DEPLOYMENT.md](DEPLOYMENT.md).

## Choose a mode

| Use case | Command | Open in a browser |
|---|---|---|
| Web development with hot reload | `./scripts/dev.sh` | `http://localhost:39176` |
| Full app directly from source | `./scripts/start.sh` | `http://localhost:39170` |
| Private-LAN production | `docker compose pull && docker compose up -d` | `http://localhost:39170` |
| Internet production with Docker and HTTPS | `docker compose -f deploy/docker-compose.caddy.yml up -d` | Your HTTPS domain |

Local development always runs directly on the host with `scripts/dev.sh`,
`scripts/start.sh`, or `go run`. Docker is reserved for released-image checks
and production deployment; the root Compose file no longer builds a working
tree.

The Go server defaults to `:39170`. A leading colon means it listens on all
interfaces, not only localhost.

Every port Kuraki binds is declared once, in `internal/config/ports.go`, and
generated out to `ports.env` and a mobile constant by `make ports`. They are
deliberately uncommon, and deliberately different from each other, so a
container, a hot-reload session, a Metro bundler and the browser suite can all
run at the same time — and so none of them fights the next project on your
machine for port 3000:

| Port | What |
|---|---|
| `39170` | The server itself: container, Compose publish, `start.sh`, and what a phone assumes for a LAN address typed without one |
| `39175` | The Go API under `./scripts/dev.sh` |
| `39176` | The Vite hot-reload web UI — the one to open while developing |
| `39177` | The Metro bundler for the mobile client |
| `39178` | The throwaway server `make e2e` boots |

## Local development

### Requirements

- Go 1.26 or newer
- Node.js 24 (the required version is in `web/.nvmrc`)
- npm
- ffmpeg on `PATH` for video posters and playback derivatives
- Optional: libvips and `pkg-config` only when using `make build-vips`

Check the main tools:

```sh
go version
node --version
npm --version
ffmpeg -version
```

The default source build is deliberately pure Go. It handles the core image
formats without libvips. Install libvips and use `make build-vips` when local
development needs the broader image pipeline. Released Docker images include
libvips, ffmpeg, and Tesseract for production.

### Hot-reload development

From the repository root:

```sh
./scripts/dev.sh
```

This starts two processes and stops both with `Ctrl-C`:

- Go API/media server: `http://localhost:39175`
- Vite/SvelteKit web UI: `http://localhost:39176`

Open `http://localhost:39176`, not the API port, while developing the web UI. Vite
proxies `/api`, `/healthz`, `/metrics`, and `/download` to the Go process.

Writes go through that proxy too. The server refuses browser cross-origin state
changes, so the proxy deliberately preserves the browser's `Host` header; if
that is ever changed, every sign-in, upload and edit fails with
`cross_origin_request` while reads keep working.

The script installs web dependencies when `web/node_modules` is absent. To keep
development data separate from another library, pass a dedicated data path
(anything matching `kuraki-data*` is gitignored):

```sh
./scripts/dev.sh --data-dir ./kuraki-data-dev
```

To use another API port, set `KURAKI_PORT`. Do not pass `--addr` to `dev.sh`,
because the Vite proxy must move with the API:

```sh
KURAKI_PORT=39185 ./scripts/dev.sh --data-dir ./kuraki-data-dev
```

The UI remains at `http://localhost:39176`; its API proxy now points to port
39185.

### One production-like process from source

To rebuild the SvelteKit UI, embed it in the Go binary, and serve everything
from one process:

```sh
./scripts/start.sh
```

Open `http://localhost:39170`. Stop it with `Ctrl-C`.

Use another port or data directory as follows:

```sh
./scripts/start.sh --addr :4000 --data-dir ./kuraki-data-dev
```

The equivalent default shortcut is:

```sh
make start
```

`make run` only rebuilds the Go binary; it does not rebuild the embedded web
assets first. Use `make start` when web source may have changed.

### Run only the Go command

This is useful when working only on server code:

```sh
go run ./cmd/kuraki serve --addr :4000 --data-dir ./kuraki-data-dev
```

Configuration precedence is:

```text
defaults < settings saved in the database < environment variables < CLI flags
```

Only catalogued settings can be changed in the web Settings page. Listen
address, data directory, public URL, proxy trust, secure cookies, and Android
APK path remain operator-controlled.

### Check ports and health

On macOS, check whether a port is already occupied:

```sh
lsof -nP -iTCP:39170 -sTCP:LISTEN   # a deployed/production-like server
lsof -nP -iTCP:39175 -sTCP:LISTEN   # the dev API
lsof -nP -iTCP:39176 -sTCP:LISTEN   # the dev web UI
```

On Linux, use:

```sh
ss -ltnp | grep -E ':(39170|39175|39176)[[:space:]]'
```

Once the server is running:

```sh
curl -f http://127.0.0.1:39170/healthz
```

If a port is busy, pick another. To bind a source run only to the local
machine, use `--addr 127.0.0.1:39185` instead of `:39185`.

### Run development checks

Before handing off a code change, run the checks relevant to what changed:

```sh
make check                           # Go formatting, vet, and race-enabled tests
(cd web && npm run check)            # Svelte/TypeScript check
(cd web && npm run build)            # production web build
make check-gen                       # generated API/client contract drift
make e2e                             # browser tests against a real server
```

`make e2e` needs its Playwright browser installed.

## Production with Docker

### Requirements

- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose`, with a space)

### Private-LAN production

The root Compose file runs the published image, exposes plain HTTP on a trusted
private network, and stores the library in `./kuraki-data`. It never builds the
current checkout:

```sh
docker compose pull
docker compose up -d
```

Open `http://localhost:39170` and create the first admin account.

Useful lifecycle commands:

```sh
docker compose ps
docker compose logs -f kuraki
docker compose restart kuraki
docker compose stop
docker compose down
```

`docker compose down` removes the container and network, but this Compose file
uses a host bind mount, so the library remains in `./kuraki-data`. Still, treat
that directory as irreplaceable data: do not delete it, and back it up.

If host port 39170 is occupied, change only the host side of the mapping in
`docker-compose.yml`:

```yaml
ports:
  - "39180:39170"
```

Keep `KURAKI_ADDR: ":39170"` inside the container. Open
`http://localhost:39180`, and set `KURAKI_PUBLIC_URL` to the externally reachable
address if a phone will pair with this server.

### Internet production with HTTPS

Do not expose Kuraki's plain HTTP port directly to the internet. The supported
example places Caddy in front of Kuraki. Caddy owns public ports 80 and 443,
obtains and renews the TLS certificate, and reaches Kuraki over a private Docker
network.

### Before deployment

You need:

1. A server with Docker Engine and Docker Compose v2.
2. A domain such as `photos.example.com`.
3. DNS `A` and/or `AAAA` records pointing that domain to the server.
4. Inbound TCP ports 80 and 443 allowed through the firewall/router.
5. A durable data location and, ideally, a separate disk or remote destination
   for backups.

### Configure the production stack

1. In `deploy/Caddyfile`, replace `photos.example.com` with the real domain.
2. In `deploy/docker-compose.caddy.yml`, use explicit host paths for data and
   backups. For example:

   ```yaml
   volumes:
     - /srv/kuraki/data:/data
     - /mnt/kuraki-backups:/backups
   ```

3. In the same Compose file, uncomment and set the public URL:

   ```yaml
   environment:
     KURAKI_PUBLIC_URL: "https://photos.example.com"
   ```

4. Keep these settings enabled in this topology:

   ```yaml
   KURAKI_SECURE_COOKIES: "1"
   KURAKI_TRUST_PROXY: "1"
   KURAKI_BACKUP_DIR: /backups
   ```

The production Compose file intentionally has no `ports:` entry for Kuraki.
Only Caddy can reach it. That restriction is what makes
`KURAKI_TRUST_PROXY=1` safe; otherwise a direct client could forge forwarding
headers and weaken the IP-based login and pairing rate limits.

The container runs as UID/GID 10001. On a Linux host, create the bind-mount
directories and make them writable by that identity if needed:

```sh
sudo mkdir -p /srv/kuraki/data /mnt/kuraki-backups
sudo chown -R 10001:10001 /srv/kuraki/data /mnt/kuraki-backups
```

Do not recursively change ownership on an existing library without first
checking its current ownership and taking a backup.

### Pull and start

From the repository root:

```sh
docker compose -f deploy/docker-compose.caddy.yml pull
docker compose -f deploy/docker-compose.caddy.yml up -d
docker compose -f deploy/docker-compose.caddy.yml ps
```

Watch startup and certificate logs:

```sh
docker compose -f deploy/docker-compose.caddy.yml logs -f kuraki caddy
```

Open the configured HTTPS domain and create the first admin account. Confirm
that plain HTTP redirects to HTTPS and that the Kuraki container reports
healthy:

```sh
curl -f https://photos.example.com/healthz
docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' kuraki
```

If certificate issuance fails, first check DNS, ports 80/443, the host
firewall, and the Caddy logs.

### Production security checklist

- Kuraki has no directly published host port.
- Users access it only through an HTTPS URL.
- `KURAKI_SECURE_COOKIES=1` is set.
- `KURAKI_TRUST_PROXY=1` is set only because Caddy is the sole route to Kuraki.
- `KURAKI_PUBLIC_URL` exactly matches the URL browsers and phones use.
- The data and backup directories are not publicly served by another service.
- Backups are stored on separate hardware or copied off-site.
- The host OS, Docker, Caddy image, and Kuraki image receive security updates.
- Access to Docker and the host filesystem is restricted; either grants access
  to the complete library.

Kuraki is not end-to-end encrypted: the server must read originals to make
thumbnails and search metadata. Protect the host, its disks, and its backups.

## Configuration reference

| Environment variable | Default | Purpose |
|---|---|---|
| `KURAKI_DATA_DIR` | `./kuraki-data` (`/data` in Docker) | Database, originals, derivatives, trash, staging, and snapshots |
| `KURAKI_ADDR` | `:39170` | HTTP listen address inside the process/container |
| `KURAKI_PUBLIC_URL` | empty | Reachable browser/mobile URL, especially important in Docker or behind a proxy |
| `KURAKI_TRASH_RETENTION_DAYS` | `30` | Days before trashed media is purged |
| `KURAKI_CHANGELOG_KEEP` | `100000` | Delta-sync rows retained before an old client must resync |
| `KURAKI_THUMBNAIL_SIZE` | `512` | Thumbnail longest edge in pixels |
| `KURAKI_OCR` | off | Enable local Tesseract OCR with `1` |
| `KURAKI_SECURE_COOKIES` | off | Secure cookies and HSTS; enable only when clients use HTTPS |
| `KURAKI_TRUST_PROXY` | off | Trust proxy client-IP headers; enable only when direct access is impossible |
| `KURAKI_METRICS_TOKEN` | empty | Bearer token for non-browser access to `/metrics` |
| `KURAKI_BACKUP_DIR` | empty | Enable scheduled portable backups in this directory |
| `KURAKI_BACKUP_INTERVAL_HOURS` | `24` | Scheduled backup interval |
| `KURAKI_BACKUP_KEEP` | `7` | Number of scheduled archives retained |
| `KURAKI_ANDROID_APK` | `<data>/downloads/kuraki-android.apk` | APK served from `/download/android` |

Boolean environment variables accept values such as `1` to enable them. Values
set in the environment pin the corresponding web-editable server settings, so
the web UI cannot silently override an operator's deployment configuration.

### Pairing a phone

`localhost` on a phone means the phone itself. Set `KURAKI_PUBLIC_URL` to an
address reachable from the phone:

```yaml
KURAKI_PUBLIC_URL: "http://192.168.1.20:39170"  # trusted LAN
```

or:

```yaml
KURAKI_PUBLIC_URL: "https://photos.example.com" # production HTTPS
```

Then use the web app's Devices page to create a single-use pairing code or QR.

## Routine operations

Commands in this section that include
`-f deploy/docker-compose.caddy.yml` target the internet-facing Caddy stack.
Remove that option to run the equivalent command against the private-LAN
production stack.

### View status and logs

Private-LAN production:

```sh
docker compose ps
docker compose logs --tail 100 kuraki
docker compose logs -f kuraki
```

Caddy production:

```sh
docker compose -f deploy/docker-compose.caddy.yml ps
docker compose -f deploy/docker-compose.caddy.yml logs --tail 100 kuraki
```

The public liveness endpoint is `/healthz`. `/metrics` requires an admin session
or this header when `KURAKI_METRICS_TOKEN` is configured:

```sh
curl -H "Authorization: Bearer $KURAKI_METRICS_TOKEN" \
  https://photos.example.com/metrics
```

### Import an existing folder

The container can only see mounted paths. Add a read-only inbox mount to the
Kuraki service before importing:

```yaml
volumes:
  - /srv/kuraki/data:/data
  - /srv/photos-to-import:/inbox:ro
```

Then run:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki import /inbox --data-dir /data
```

For a continuously rescanned folder:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki import /inbox --watch --data-dir /data
```

This watch command stays attached until interrupted. For permanent automation,
define it as a separately supervised service rather than depending on an
interactive shell.

### Verify library integrity

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki verify --data-dir /data
```

The command re-checks originals and exits non-zero if files are missing or their
checksums differ.

### Backups

The Caddy production example enables automatic, SQLite-consistent portable
backups in `/backups`, every 24 hours, retaining seven by default. The backup
mount should be a separate disk, and its archives should also be copied off-site.

Write the archive somewhere outside the library. A backup is a copy of the data
directory, so a destination inside it is a file that grows as it is written; the
command now skips its own output rather than trying to archive it, but keeping
backups on separate storage is the point of them anyway.

**Verify a backup by restoring it**, not by looking at it. Restore into an empty
directory and count what came back — see below. A truncated archive still lists
plausible entries.

Create an additional manual backup while the server is online:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki backup /backups/manual-kuraki.tar.gz --data-dir /data
```

This is different from `data/snapshots/`: migration snapshots protect database
upgrades, while portable backup archives are the recovery artifact for the whole
library.

### Restore safely

Restore accepts only an empty target directory. Do not point it at a live data
directory. Restore to a new host path first, validate it, and then change the
Compose data mount during a maintenance window.

Example using the published image and two host mounts:

```sh
mkdir -p /srv/kuraki/restored-data
sudo chown 10001:10001 /srv/kuraki/restored-data

docker run --rm \
  -v /srv/kuraki/restored-data:/restore \
  -v /mnt/kuraki-backups:/backups:ro \
  ghcr.io/kuraki-app/kuraki:latest \
  restore /backups/kuraki-backup-YYYYMMDDTHHMMSSZ.tar.gz \
  --data-dir /restore
```

After restoring:

1. Keep the current library untouched as a rollback copy.
2. Point the Kuraki `/data` bind mount at `/srv/kuraki/restored-data`.
3. Start Kuraki and wait for it to become healthy.
4. Sign in and check asset counts, several originals, thumbnails, albums, and
   recent changes before retiring the old library.

### Account recovery

Reset a password from an interactive terminal:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki passwd --username owner --data-dir /data
```

List accounts:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki userlist --data-dir /data
```

Create an account offline when necessary:

```sh
docker compose -f deploy/docker-compose.caddy.yml exec kuraki \
  kuraki useradd --username another-user --role user --data-dir /data
```

### Upgrade production

1. Confirm a recent portable backup exists on separate storage.
2. Pull the target image.
3. Recreate the service.
4. Wait for health and inspect logs.
5. Smoke-test login, timeline, thumbnails, and one original download.

```sh
docker compose -f deploy/docker-compose.caddy.yml pull kuraki
docker compose -f deploy/docker-compose.caddy.yml up -d kuraki
docker compose -f deploy/docker-compose.caddy.yml ps
docker compose -f deploy/docker-compose.caddy.yml logs --tail 100 kuraki
```

Kuraki takes an automatic database snapshot before schema migrations. For
repeatable deployments, pin the `image:` field to a released version tag rather
than `latest`. Rolling back only the container image may not roll back a migrated
database; restore the matching portable backup into an empty directory when a
full data rollback is required.

### Stop or remove containers

Stop while retaining the containers:

```sh
docker compose -f deploy/docker-compose.caddy.yml stop
```

Remove containers and the Compose network:

```sh
docker compose -f deploy/docker-compose.caddy.yml down
```

The library and backup bind mounts remain on the host. Avoid `down -v` unless
you have resolved exactly which named volumes it will remove; the Caddy named
volumes contain certificate state.

## Troubleshooting

### `bind: address already in use`

Another process owns the port. Stop that process or choose another port. For
hot reload use `KURAKI_PORT=39185`; for a single source process use
`--addr :39185`; for Docker change the host half of `39180:39170`.

### Container is healthy but the port does not answer

`docker ps` can show a published port that nothing is actually listening on. If
another process owned the host port when the container started, the port
forward is never established, and it is not retried when that process later
exits. The container keeps reporting healthy, because `HEALTHCHECK` runs
`kuraki healthcheck` *inside* the container and never crosses the port mapping.

Confirm with the host, not with Docker:

```sh
lsof -nP -iTCP:39170 -sTCP:LISTEN     # macOS: expect Docker/OrbStack, not another app
curl -f http://127.0.0.1:39170/healthz
docker exec kuraki kuraki healthcheck   # succeeds even while the mapping is broken
```

Recreate the container once the port is free:

```sh
docker compose up -d kuraki
```

### Container is unhealthy or restarting

```sh
docker compose ps
docker compose logs --tail 200 kuraki
docker inspect kuraki
```

Common causes are an unwritable data mount, a port conflict, a malformed
environment value, or an unavailable/corrupt data path.

### `permission denied` under `/data` or `/backups`

The image runs as UID/GID 10001. Inspect the exact host directory, back it up,
and fix that directory's ownership or ACL. Do not broadly run recursive
ownership commands against an unresolved path.

### Browser works but a phone cannot connect

- Do not pair with a `localhost` URL.
- Set `KURAKI_PUBLIC_URL` to the LAN address or production HTTPS domain.
- On a LAN, allow the chosen host port through the host firewall.
- Across the internet, use HTTPS through Caddy; do not publish Kuraki's port.
- Confirm the phone can open `<public-url>/healthz` on its current network.

### HTTPS certificate does not appear

Confirm the domain resolves to the correct public IP, ports 80 and 443 reach
Caddy, no other service owns those ports, and the Caddy container logs do not
show an ACME challenge failure.

### Embedded UI looks stale

A Go binary or Docker image contains the web UI that existed when it was built.
Use `./scripts/start.sh` for a fresh source build or pull and recreate the
production image. Use `./scripts/dev.sh` while actively editing the UI; do not
build a Docker image to preview working-tree changes.
