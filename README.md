<div align="center">

# 蔵 Kuraki

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

It's delivered as a Docker image with the media toolchain (libvips + ffmpeg) built in, so
HEIC/AVIF/RAW previews and video posters work out of the box.

## Features

**Import & backup**
- CLI bulk import with a progress bar, `--dry-run`, and resume-on-interrupt
- Content-hash **deduplication** (BLAKE3) — the same photo in two folders is stored once
- EXIF-date organization into `originals/YYYY/MM/`; originals are write-once
- **Watch-folder** mode (`import --watch`) that auto-imports new files — pairs with Syncthing/rsync
- Browser drag-and-drop upload, processed by a background **import queue** (retries + crash recovery),
  with an **Activity** view showing progress and per-file errors
- **Google Takeout import** — reads the JSON sidecars so capture dates, locations, captions, and
  favorites survive a migration from Google Photos

**Browse & find**
- Virtualized, day/month-grouped **timeline** that stays smooth at large libraries
- Full-screen **viewer** with EXIF panel, keyboard navigation, and original download
- **Search** by filename, date range, media type, and camera model (SQLite FTS5, prefix matching)
- **Favorites** feed, **albums**, and an **"on this day"** memories view
- **Places** map of geotagged photos with **offline** reverse geocoding (city/country, no external calls)
- Multi-select **batch** operations and **zip export** of selected originals
- **Library dashboard** with totals and a per-year breakdown

**Edit & organize**
- Edit an asset's **capture date, location, and caption** (re-geocoding on a location change)
- **Batch timezone shift** to correct camera clocks across many photos
- Manual **albums** (create, rename, delete, add/remove)

**Media**
- Thumbnails via **libvips** (HEIC/AVIF/RAW previews) with a pure-Go fallback
- **Video** upload, ffmpeg poster frames, and in-browser playback with range/seek support

**Trust, performance & operations**
- **Trash** with configurable retention, restore, and automatic purge
- `kuraki verify` re-checksums the library and reports corruption or missing originals
- Automatic **pre-migration database snapshot** on every schema change — upgrades are boring
- Single-owner **auth** (argon2id, session cookies, rate-limited login)
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

### Docker

```sh
docker run -d -p 3000:3000 -v "$PWD/kuraki-data:/data" ghcr.io/kuraki-app/kuraki:latest
```

### Bulk import from the command line

```sh
docker compose exec kuraki kuraki import /data/incoming
# or watch a folder and auto-import new files:
docker compose exec kuraki kuraki import /data/incoming --watch
```

## Configuration

Sensible defaults, no config file required. Override via flags or environment
(precedence: defaults < env < flags).

| Flag | Env | Default | Description |
|---|---|---|---|
| `--data-dir` | `KURAKI_DATA_DIR` | `./kuraki-data` | Library root (DB, originals, derivatives, trash, snapshots) |
| `--addr` | `KURAKI_ADDR` | `:3000` | HTTP listen address |
| — | `KURAKI_TRASH_RETENTION_DAYS` | `30` | Days a trashed item is restorable before purge |
| — | `KURAKI_THUMBNAIL_SIZE` | `512` | Thumbnail longest-edge size in pixels |
| — | `KURAKI_OCR` | off | Enable the opt-in local OCR worker (needs `tesseract` on PATH) |
| — | `KURAKI_SECURE_COOKIES` | off | Mark the session cookie `Secure` — enable behind HTTPS |
| — | `KURAKI_TRUST_PROXY` | off | Trust `X-Forwarded-For`/`X-Real-IP` for the client IP — enable **only** behind a trusted reverse proxy |
| — | `KURAKI_METRICS_TOKEN` | — | Bearer token that lets scrapers read `/metrics`; an owner session can always read it |

## Commands

| Command | Description |
|---|---|
| `kuraki serve` | Start the web server |
| `kuraki import <dir>` | Bulk-import a directory (`--dry-run`, `--watch`, `--watch-interval`, `--thumb-workers`) |
| `kuraki verify` | Re-checksum the library and report mismatches |
| `kuraki version` | Print version |

## Architecture

- **Server:** Go with an embedded SvelteKit web UI (`go:embed`).
- **Database:** SQLite (WAL) via pure-Go `modernc.org/sqlite`; FTS5 search; versioned `goose`
  migrations with automatic pre-migration snapshots.
- **Media:** libvips (govips) for thumbnails and ffmpeg for video posters, behind a `Processor`
  interface with a pure-Go fallback.
- **Storage:** filesystem, write-once originals, all access behind a `Storage` interface (S3 later).
- **Schema principles:** UUIDv7 keys, `owner_id` on every asset, soft deletes, BLAKE3 hashes,
  and a `change_log` table for future sync.

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
├── cmd/kuraki/              # CLI entrypoint (cobra): serve / import / verify / healthcheck / version
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
│   ├── geo/                # offline reverse geocoding (embedded cities dataset)
│   ├── queue/              # background import queue (worker, retries, jobs)
│   ├── trash/              # soft-delete, restore, retention purge
│   ├── verify/             # integrity re-checksum
│   ├── auth/               # argon2id hashing, session tokens
│   └── httpapi/            # chi router, handlers, middleware; assets/ = embedded UI
├── web/                    # SvelteKit source, built into internal/httpapi/assets
├── Dockerfile              # runtime bundles libvips + ffmpeg
├── docker-compose.yml
└── ROADMAP.md              # milestone & progress tracker
```

**Architectural rule:** `internal/domain` performs no I/O. All file access goes through
`storage.Storage`; all image work through `media.Processor`.

## Development

Requires **Go 1.26+**. For the full media pipeline you also need libvips and ffmpeg — or just
use Docker, which includes them.

```sh
make build        # build the server binary
make run          # build + serve on :3000
make test         # go test -race ./...
make build-vips   # build with the libvips backend (-tags vips)
make docker       # build the container image
```

The default `go build` produces a CGO-free build with pure-Go media (JPEG thumbnails, no HEIC).
Build with `-tags vips` (or use the Docker image) to link libvips for the full format support.

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## Roadmap

Phase 1 (personal backup & sync) → Phase 2 (multi-user & sharing) → Phase 3 (mobile & optional ML).
Live status: **[ROADMAP.md](./ROADMAP.md)**.

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please **don't** open a public issue — see [SECURITY.md](./SECURITY.md).
Note: Kuraki has **no server-side E2EE** (the server reads your files to generate thumbnails and
power search).

## License

[GNU AGPL-3.0](./LICENSE) © Saransh.
