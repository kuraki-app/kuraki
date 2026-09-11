<div align="center">

# Kuraki

**Self-hosted photo & video backup with a fast web library — run it on your own server.**

[![CI](https://github.com/kuraki-app/kuraki/actions/workflows/ci.yml/badge.svg)](https://github.com/kuraki-app/kuraki/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Go](https://img.shields.io/badge/go-1.26+-00ADD8.svg?logo=go&logoColor=white)](https://go.dev)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](./ROADMAP.md)

*"Google Photos for your own hardware."*

</div>

---

## What is Kuraki?

Kuraki is an open-source photo and video backup platform you host yourself. It gives you a
Google-Photos-style web experience — a smooth timeline, a full-screen viewer, search, albums,
and favorites — over a library you fully control. Your originals stay on your own server, are
written once and never modified after import, and remain organized in a readable
`originals/YYYY/MM/` folder layout, so you are never locked in.

The Docker image uses libvips for broad image decoding, ffmpeg for video
posters, and optional OCR support. The native default stays pure-Go. Browser
preview/playback support is deliberately narrower than import support; see the
[media support matrix](./MEDIA_SUPPORT.md), and unsupported originals remain
downloadable.

**New here?** [USER_GUIDE.md](./USER_GUIDE.md) describes what Kuraki does as a
sequence of flows — what each one needs from you, what the server does with it, and
what comes back — with no code and no installation detail. This README is how to run
it; that is how it behaves.

## Features

**Import & backup**
- CLI bulk import with a progress bar, `--dry-run`, and resume-on-interrupt
- Content-hash **deduplication** (BLAKE3) — the same photo in two folders is stored once
- EXIF-date organization into `originals/YYYY/MM/`; originals are write-once
- **Watch-folder** mode (`import --watch`) that auto-imports new files — pairs with Syncthing/rsync
- Browser drag-and-drop upload, processed by a background **import queue** (retries + crash recovery),
  with an **Activity** view showing progress and per-file errors
- **Immich migration** — `kuraki migrate immich` pulls a whole library over Immich's API,
  keeping albums, tags, favorites, ratings, archive state, captions, locations, and stacks
- **Google Takeout import** — reads the JSON sidecars so capture dates, locations, captions, and
  favorites survive a migration from Google Photos

**Browse & find**
- Virtualized, day/month-grouped **timeline** that stays smooth at large libraries
- Full-screen **viewer** with EXIF panel, keyboard navigation, and original download
- **Search** by filename, caption, date range, media type, camera, place, **tag**, and
  **rating** — one filter language shared by the web filter bar, `/api/search`, and the phone
- Search matches **inside** words, not only at their start (`0001` finds `IMG_0001.jpg`): SQLite
  FTS5 with a trigram index alongside the prefix one, routed per query
- **Saved searches** — store a filter set as a named smart filter and re-apply it in one click
- **Jump-to-date** to leap the timeline to any day
- **Favorites** feed, **albums**, and an **"on this day"** memories view
- **Places** map of geotagged photos with **offline** reverse geocoding (city/country, no external calls)
- **Duplicate review** — a durable, resumable, all-library perceptual-hash scan groups near-identical
  copies for you to resolve (nothing is ever deleted automatically)
- **Archive** and **Hidden** shelves keep clutter out of the main timeline
- **Stacks** — a RAW+JPEG pair or a Live/Motion photo shows as one item with the rest a click
  away; detection is automatic, deterministic, and hides nothing
- Multi-select **batch** operations and **zip export** of selected originals
- **Library dashboard** with totals and a per-year breakdown

**Edit & organize**
- Edit an asset's **capture date, location, and caption** (re-geocoding on a location change)
- **Batch timezone shift** to correct camera clocks across many photos
- Manual **albums** (create, rename, delete, add/remove)
- **Tags** (hierarchical) — browse by tag and edit an asset's tags from web or phone
- Star **ratings** (0–5), filterable and settable from either client
- **Archive/hide** to shape what shows in the timeline
- **External libraries** — index a folder already on the server **in place**: nothing is copied or
  moved, and unlinking it forgets the index without touching a file (admin-only, since it names a
  server path)

**Media**
- Docker/libvips thumbnails for supported still-image formats; the native
  `go build` default stays pure-Go for common browser-decodable images
- **Video** upload, ffmpeg poster frames, and in-browser playback with range/seek support

**Mobile app (iOS & Android)**
- A shared Expo/React Native client ([`mobile/`](./mobile)) that pairs to your server with a
  **revocable device token** (scan the QR on the Devices page, or enter the address by hand)
- **Automatic camera-roll backup** — restart- and network-loss-safe, resumable, with OS
  background scheduling and an honest per-item "Needs attention" state
- **Browse your library on the phone** — search and filter over an infinite grid, with an
  **offline SQLite cache** so the timeline opens instantly and stays usable with no connection
- **Albums**, an **"on this day"** memories view, and a **Trash** with restore / permanent delete
- **Places** — a native **MapLibre** map (OpenFreeMap vector tiles, no API key) that clusters your
  geotagged photos; tap a place to see its grid
- **Tags** — tag a photo from the viewer and browse by tag (offline-queued, like every other edit)
- **Duplicate review** — resolve near-identical copies on the phone with native controls
- **Native gestures** — drag-to-select on the grid, pinch to change grid density, pinch-zoom and
  swipe-to-dismiss in the viewer
- **Album covers** drawn as a 2x2 mosaic of the album's newest photos
- **Favorite from the phone**, connection-aware banners (an unreachable server keeps the cached
  library browsable; a revoked device prompts a re-pair), a **server-authoritative** sync model
  (all edits queue offline and reconcile on reconnect), and a look ported from the web design

**Trust, performance & operations**
- **Trash** with configurable retention, restore, and automatic purge
- `kuraki verify` re-checksums the library and reports corruption or missing originals
- Automatic **pre-migration database snapshot** on every schema change — upgrades are boring
- **Accounts with isolated libraries** — argon2id, session cookies, rate-limited login; admins
  manage accounts and server settings, and there is deliberately **no path from one account to
  another's photos**
- **Delta sync** — every asset mutation is logged, so a browser tab updates live (server-sent
  events) and a phone reconciles offline edits on reconnect
- **Generated API contract** — OpenAPI served at `/api/openapi.json`, with both clients' types
  generated from it and drift gated in CI
- Aggressive HTTP caching for media/UI, gzip for API responses, and SQLite tuning
- `/healthz` (public) and `/metrics` (owner-session or `KURAKI_METRICS_TOKEN` bearer) endpoints for monitoring

## Quick start

### Docker Compose (recommended)

```sh
git clone https://github.com/kuraki-app/kuraki
cd kuraki
docker compose up -d
```

Open <http://localhost:3000> and create your admin account on first visit. Your library lives in
`./kuraki-data` — back up that directory and you have everything.

The container runs a single process — `kuraki serve` on `:3000` — which serves the API, media, and
the web UI (including first-run setup) from one origin.

> **Exposing it to the internet?** Put Kuraki behind a reverse proxy that terminates HTTPS and
> turn on `KURAKI_SECURE_COOKIES` and `KURAKI_TRUST_PROXY`. See
> **[DEPLOYMENT.md](DEPLOYMENT.md)** for a ready-to-run Caddy (automatic HTTPS) or
> nginx setup and the security rationale — getting `TRUST_PROXY` wrong silently weakens the
> login rate limits.

### Docker

```sh
docker run -d -p 3000:3000 -v "$PWD/kuraki-data:/data" ghcr.io/kuraki-app/kuraki:latest
# :3000 = Go server: API + media + web UI (single origin)
```

### Bulk import from the command line

```sh
docker compose exec kuraki kuraki import /data/incoming
# or watch a folder and auto-import new files:
docker compose exec kuraki kuraki import /data/incoming --watch
```

### Coming from Immich or Google Photos

```sh
docker compose exec kuraki kuraki migrate immich \
  --url https://immich.example --api-key "$IMMICH_KEY"
```

Albums, tags, favorites, ratings, archive state, captions, locations and stacks
come across; the migration is resumable and safe to re-run. See
**[MIGRATING.md](MIGRATING.md)** for what does and does not transfer, and for
Google Photos via Takeout.

## Configuration

Sensible defaults, no config file required. Override via flags or environment
(precedence: defaults < env < flags).

| Flag | Env | Default | Description |
|---|---|---|---|
| `--data-dir` | `KURAKI_DATA_DIR` | `./kuraki-data` | Library root (DB, originals, derivatives, trash, snapshots) |
| `--addr` | `KURAKI_ADDR` | `:3000` | HTTP listen address |
| — | `KURAKI_TRASH_RETENTION_DAYS` | `30` | Days a trashed item is restorable before purge |
| — | `KURAKI_CHANGELOG_KEEP` | `100000` | Newest change-log rows kept for the delta-sync feed; older rows are pruned and lagging clients are told to resync |
| — | `KURAKI_THUMBNAIL_SIZE` | `512` | Thumbnail longest-edge size in pixels |
| — | `KURAKI_OCR` | off | Enable the opt-in local OCR worker (needs `tesseract` on PATH) |
| — | `KURAKI_SECURE_COOKIES` | off | Mark the session cookie `Secure` and send HSTS — enable behind HTTPS |
| — | `KURAKI_TRUST_PROXY` | off | Trust `X-Forwarded-For`/`X-Real-IP` for the client IP — enable **only** behind a trusted reverse proxy |
| — | `KURAKI_METRICS_TOKEN` | — | Bearer token that lets scrapers read `/metrics`; an owner session can always read it |
| — | `KURAKI_PUBLIC_URL` | — | The address other devices should use to reach this server (e.g. `https://photos.example.com`). Set it in Docker or behind a reverse proxy — see below |
| — | `KURAKI_BACKUP_DIR` | — | Enable unattended backups: write a SQLite-consistent archive here on an interval (keep it on a **separate disk/mount**) |
| — | `KURAKI_BACKUP_INTERVAL_HOURS` | `24` | How often the unattended backup runs when `KURAKI_BACKUP_DIR` is set |
| — | `KURAKI_BACKUP_KEEP` | `7` | How many recent automatic archives to retain before pruning older ones |
| — | `KURAKI_ANDROID_APK` | `<data>/downloads/kuraki-android.apk` | Path to the Android app package served at `/download/android` |

### The address a phone should connect to

The **Devices** page offers the address to type into the phone. On a bare-metal install the server
reads it off its own network interfaces, which is right. In a container it is not: the only
interface a container has is a bridge address on the *container's* port, which no phone can route
to — and behind a reverse proxy neither the scheme, the host nor the port matches the listener.

So in a container the server offers nothing and the page keeps the address your browser is already
using, which at least works whenever you are not browsing from the server itself. To give a
definite answer instead, set `KURAKI_PUBLIC_URL`:

```yaml
environment:
  KURAKI_PUBLIC_URL: "http://192.168.1.20:3000"   # or https://photos.example.com
```

### Android app download

The server serves an Android APK at **`/download/android`** (linked from the **Devices** page). Drop
your built APK at `kuraki-data/downloads/kuraki-android.apk` — or point `KURAKI_ANDROID_APK` at another
path — and it becomes downloadable; until then the endpoint returns 404. Build the APK with EAS
(`cd mobile && eas build -p android --profile preview`) or a local Gradle build.

## Commands

| Command | Description |
|---|---|
| `kuraki serve` | Start the web server |
| `kuraki import <dir>` | Bulk-import a directory (`--dry-run`, `--watch`, `--watch-interval`, `--thumb-workers`) |
| `kuraki migrate immich` | Migrate a library from an Immich server, metadata intact (`--url`, `--api-key`, `--dry-run`, `--resume`, `--include-trashed`, `--since`) — see [MIGRATING.md](MIGRATING.md) |
| `kuraki migrate status [run-id]` | List migration runs and their progress |
| `kuraki verify` | Re-checksum the library and report mismatches |
| `kuraki backup <archive.tar.gz>` | Create a portable, SQLite-consistent library backup |
| `kuraki restore <archive.tar.gz>` | Restore a backup into an empty library |
| `kuraki passwd` | Reset an account password offline (`--username`, reads the new password from the terminal or piped stdin) — the recovery path when locked out of the web UI |
| `kuraki useradd` | Create an account offline (`--username`, `--role admin\|user`) |
| `kuraki userlist` | List accounts, their roles, and whether they are disabled |
| `kuraki healthcheck` | Probe a running server — what the container's `HEALTHCHECK` runs |
| `kuraki version` | Print version |

## Architecture

- **Server:** Go with an embedded SvelteKit web UI (`go:embed`).
- **Database:** SQLite (WAL) via pure-Go `modernc.org/sqlite`; FTS5 search; versioned `goose`
  migrations with automatic pre-migration snapshots.
- **Media:** a pure-Go default processor plus an optional `-tags vips` libvips
  profile, with ffmpeg for video posters, behind a `Processor` interface.
- **Storage:** filesystem, write-once originals, all access behind a `Storage` interface (S3 later).
- **Schema principles:** UUIDv7 keys, `owner_id` on every asset (mechanically enforced by a guard
  test that fails the build on unscoped asset SQL), soft deletes, BLAKE3 hashes, and a `change_log`
  that backs delta sync.
- **API contract:** OpenAPI generated from the handlers, served at `/api/openapi.json`; the web and
  mobile TypeScript types are generated from it and CI fails on drift.
- **Two auth principals, one route tree:** a session cookie (browser) or a bearer device token
  (phone) resolve to the same owner, so both clients reach the same functionality.

### On-disk library layout

```
kuraki-data/
├── kuraki.db                       # SQLite (WAL): metadata + pointers only
├── originals/2026/07/IMG_1234.jpg  # write-once, readable layout, never modified after import
├── derivatives/<id>/thumb_512.webp # generated thumbnails / video posters
├── trash/                          # retention window before purge
├── staging/                        # uploads awaiting background import
└── snapshots/kuraki-<ts>.db        # pre-migration backups
```

## Repository structure

```
kuraki/
├── cmd/kuraki/              # CLI entrypoint (cobra): serve / import / migrate / verify / backup / restore / passwd / version
├── internal/
│   ├── app/                # composition root — wires config→db→storage→media→http
│   ├── config/             # zero-config defaults + env/flag resolution
│   ├── domain/             # core entities (Asset, User, …) — no I/O
│   ├── db/                 # SQLite open (WAL), migrations, pre-migration snapshot
│   │   └── migrations/     # embedded, versioned goose SQL
│   ├── storage/            # Storage interface + filesystem impl (S3 later)
│   ├── media/              # Processor interface + libvips/pure-Go backends, ffmpeg, EXIF
│   ├── importer/           # bulk import: walk, BLAKE3 dedup, resume, thumbnails
│   ├── takeout/            # Google Takeout sidecar parsing
│   ├── migrate/            # library migration engine (source-agnostic) + immich/ REST source
│   ├── geo/                # offline reverse geocoding (embedded cities dataset)
│   ├── queue/              # background import queue (worker, retries, jobs)
│   ├── fts/                # the only writer of the FTS5 search indexes (prefix + trigram)
│   ├── duplicates/         # resumable perceptual-hash scan, LSH buckets + union-find grouping
│   ├── stacks/             # deterministic RAW+JPEG / Live-photo grouping
│   ├── external/           # index a folder in place, without copying it
│   ├── ocr/                # opt-in local text recognition (tesseract via exec)
│   ├── trash/              # soft-delete, restore, retention purge
│   ├── verify/             # integrity re-checksum
│   ├── backup/             # portable, SQLite-consistent archive + validated restore
│   ├── serversettings/     # owner-writable settings catalog (DB half of config.Store)
│   ├── auth/               # argon2id hashing, session tokens
│   └── httpapi/            # chi router, handlers, middleware
│       ├── assets/         # embedded built UI (generated — see below)
│       ├── apitypes/       # wire DTOs
│       └── apispec/        # generated OpenAPI contract
├── web/                    # SvelteKit source, built into internal/httpapi/assets (see web/README.md)
├── mobile/                 # Expo/React Native app (iOS + Android): camera-roll backup + library browsing
├── scripts/                # start.sh (one production-like process) + dev.sh (hot-reload)
├── site/                   # marketing site + docs (Astro, static output, host anywhere)
├── deploy/                 # production compose: Caddy (auto-HTTPS) + Caddyfile
├── Dockerfile              # builds the -tags vips profile; runtime bundles libvips + ffmpeg + tesseract
├── docker-compose.yml      # simple one-command local host
├── RUNNING.md              # local development + production Docker runbook
├── USER_GUIDE.md           # how Kuraki behaves, as flows — no code, no install detail
├── DEPLOYMENT.md           # production deployment & security guide
├── MIGRATING.md            # moving a library in from Immich or Google Photos
└── ROADMAP.md              # milestone & progress tracker
```

**Architectural rule:** `internal/domain` performs no I/O. All file access goes through
`storage.Storage`; all image work through `media.Processor`.

## Development

Requires **Go 1.26+** and **Node 24** (`web/.nvmrc` — Vite's content hashes depend on the
toolchain, so another Node version produces a spurious full-tree diff in the committed embedded
assets). For the full media pipeline you also need libvips and ffmpeg. Docker is reserved for
released-image verification and production deployment, not local development.

### Run from source

For the complete direct-development and Docker production runbook, including ports,
configuration, backups, upgrades, and troubleshooting, see
**[RUNNING.md](RUNNING.md)**.

```sh
./scripts/start.sh   # build the UI + binary, run ONE server on :39170 (production-like)
./scripts/dev.sh     # run API + Vite UI SEPARATELY with hot reload (ports.env)
```

- **`scripts/start.sh`** (aka `make start`) compiles the SvelteKit UI into the Go binary and runs
  a single process — the same way it runs in production. Open <http://localhost:39170>.
- **`scripts/dev.sh`** (aka `make dev`) runs the backend and frontend as two processes so the UI
  hot-reloads on save; Vite proxies `/api`, `/healthz`, `/metrics` and `/download` to the Go server.
  Open <http://localhost:39176>.

Both forward extra arguments to `kuraki serve` (e.g. `--data-dir …`). To move the API port in dev,
set `KURAKI_PORT` rather than passing `--addr` — `dev.sh` exports it so Vite's proxy follows the
server instead of being left pointing at whatever else holds 3000:

```sh
KURAKI_PORT=4000 ./scripts/dev.sh
```

### Deploy released images with Docker

```sh
docker compose pull
docker compose up -d                                   # private-LAN production on :39170
docker compose -f deploy/docker-compose.caddy.yml up -d # production: automatic HTTPS via Caddy
```

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the production setup and security settings.

### Lower-level make targets

```sh
make check        # fmt + vet + test — run before every commit
make build        # build the server binary into ./bin (UI must be built first: make web)
make web          # build the SvelteKit UI into the embedded assets
make test         # go test -race ./...
make e2e          # Playwright against a real seeded server (the only gate that sees runtime behavior)
make gen          # regenerate the OpenAPI contract + web/mobile TS types
make check-gen    # what CI runs: gen, then fail if the committed artifacts moved
make build-vips   # build with the libvips backend (-tags vips)
make docker       # build the release/production container image
make clean        # remove local builds/test caches; keep JS dependencies and library data
```

### Generated artifacts — never hand-edit these

| File | Generated from | Command |
|---|---|---|
| `internal/httpapi/apispec/openapi.json` | swag annotations on the handlers + `apitypes` | `make openapi` |
| `web/src/lib/api.gen.ts`, `mobile/src/lib/api.gen.ts` | that OpenAPI JSON | `make client-types` |
| `web/src/app.css` token block, `mobile/src/design/tokens.ts` | `design/tokens.json` | `cd web && npm run sync-design` |
| `internal/httpapi/assets/**` (the embedded UI — committed, because `go:embed` needs it in the tree) | `web/src` | `make web` |

Touching a handler signature or an `apitypes` struct means running `make gen` and committing the
diff; touching the shared design system means `npm run sync-design`; touching anything under `web/src` means
`make web` and committing the embedded-asset diff. CI gates all four.

### Type and browser gates

`npm run build` does **not** typecheck — `cd web && npm run check` (svelte-check) is the only type
gate, and `make e2e` is the only gate that sees a component throwing on mount. A console-error guard
fails any browser test on `console.error` or an uncaught page error.

The default `go build` produces a CGO-free build with pure-Go media (JPEG
thumbnails, no HEIC). Docker and `make build-vips` link the broader libvips
backend. Import acceptance is not a promise of browser preview; consult the
media support matrix.

### Web UI and mobile app

The two front-end surfaces have their own guides:

- **Web** ([web/README.md](./web/README.md)) — the SvelteKit SPA that is embedded into the Go
  binary. Develop it with `./scripts/dev.sh` (API + hot-reloading UI).
- **Mobile** ([mobile/README.md](./mobile/README.md)) — the Expo/React Native app. Develop with
  `cd mobile && npm install && npx expo start`, then pair it to a running server from the app's
  setup flow. The two surfaces share `design/tokens.json` for palette, spacing, type scale, and
  responsive metrics; generated web/mobile outputs are drift-gated in CI.

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## Roadmap

Ordered by the recurring jobs of a personal library: **Keep** (backup is a daily habit) and
**Find** (retrieve a moment in seconds) are shipped; **Maintain** (prove you can move, repair, and
recover the library) is the current focus. Multi-user shipped as **isolated libraries** — accounts
that cannot see each other's photos. Sharing (links, shared albums, household accounts), OIDC, and
any bundled ML remain deliberately **parked** — see the non-goals in **[ROADMAP.md](./ROADMAP.md)**
for the full plan and rationale.

## Documentation

| Document | What it answers |
|---|---|
| **[USER_GUIDE.md](./USER_GUIDE.md)** | How Kuraki behaves: every flow, what it needs from you, and what it does with it |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Running it in production behind HTTPS, and the settings that matter |
| [MIGRATING.md](./MIGRATING.md) | Moving a library in from Immich or Google Photos |
| [MEDIA_SUPPORT.md](./MEDIA_SUPPORT.md) | Which formats import, preview, play, and on which build |
| [CHANGELOG.md](./CHANGELOG.md) | What changed, release by release |
| [ROADMAP.md](./ROADMAP.md) | What is next, and what is deliberately not being built |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Setup, gates, and conventions for a PR |
| [SECURITY.md](./SECURITY.md) | Reporting a vulnerability |
| [web/README.md](./web/README.md) · [mobile/README.md](./mobile/README.md) | The two client surfaces |
| [AGENTS.md](./AGENTS.md) · [CLAUDE.md](./CLAUDE.md) | Working state and rules for coding agents |

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please **don't** open a public issue — see [SECURITY.md](./SECURITY.md).
Note: Kuraki has **no server-side E2EE** (the server reads your files to generate thumbnails and
power search).

## License

[GNU AGPL-3.0](./LICENSE) © Saransh.
