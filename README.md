<div align="center">

# 蔵 Kuraki

**Lightweight, self-hosted photo backup & sync — one binary, plain files, runs on a Raspberry Pi.**

[![CI](https://github.com/kuraki-app/kuraki/actions/workflows/ci.yml/badge.svg)](https://github.com/kuraki-app/kuraki/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Go](https://img.shields.io/badge/go-1.26+-00ADD8.svg?logo=go&logoColor=white)](https://go.dev)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](./ROADMAP.md)

*"Google Photos for your own hardware — without needing a datacenter to run it."*

</div>

---

## Why Kuraki?

Self-hosters escaping Google Photos face a bad trade-off. **Immich** is feature-rich but hungry — 8GB+ RAM, 4–5 containers, and stressful database migrations that OOM on a Pi. **Ente** has an efficient server but a notoriously painful self-hosting story. Neither owns the space Kuraki is built for:

> **single binary · near-zero configuration · plain-filesystem storage · runs on a Pi · boring upgrades**

Kuraki is engineered around one principle — **operational calm on minimal hardware**.

| | Immich | Ente | **Kuraki** |
|---|---|---|---|
| Resource use | High (OOM reports) | Low server, complex infra | **Low by design; ML optional & external** |
| Deployment | 5 containers, compose | S3 + DNS + museum config | **One binary / one container, zero config** |
| Storage model | Proprietary layout | S3-only encrypted blobs | **Plain files first (rsync-able, browsable)** |
| Bulk import | Good CLI | Very poor | **First-class CLI importer** |
| Upgrades | Migration horror stories | Medium | **Embedded DB, auto pre-migration snapshot** |

## Features

**Available now (M0 scaffold):**
- ⚡ Zero-config startup — one command, sensible defaults, no YAML
- 🗄️ Embedded SQLite (WAL) with versioned migrations and **automatic pre-migration snapshots**
- 📦 Single self-contained binary; cross-compiles to Linux (x64/ARM64), macOS, Windows
- 🐳 Docker image bundling libvips + ffmpeg

**In progress (see [ROADMAP.md](./ROADMAP.md)):**
- 📥 Resumable CLI bulk import with BLAKE3 content-hash dedup
- 🖼️ libvips thumbnail pipeline (HEIC/AVIF/RAW previews) + ffmpeg video posters
- 🕐 Virtualized infinite-scroll timeline (smooth at 100k+ photos)
- 🔍 Non-ML search (filename, date, camera, type) via FTS5
- 🗑️ Trash with 30-day retention · `kuraki verify` integrity checks · single-owner auth

**Zero lock-in guarantee:** your originals are written once to a human-readable `originals/YYYY/MM/` layout and never modified. Stop using Kuraki at any moment and your complete library is still just files on disk.

## Quick start

### Binary

```sh
go build -o kuraki ./cmd/kuraki    # pure-Go, no external deps
./kuraki serve                     # creates ./kuraki-data, serves on :3000
```

### Docker (recommended — full format support)

```sh
docker build -t kuraki .
docker run -p 3000:3000 -v "$PWD/kuraki-data:/data" kuraki
```

Open <http://localhost:3000>.

## Configuration

Zero-config by default. Override via flags or environment (precedence: defaults < env < flags).

| Flag | Env | Default | Description |
|---|---|---|---|
| `--data-dir` | `KURAKI_DATA_DIR` | `./kuraki-data` | Library root (DB, originals, derivatives, trash, snapshots) |
| `--addr` | `KURAKI_ADDR` | `:3000` | HTTP listen address |

## Commands

| Command | Description |
|---|---|
| `kuraki serve` | Start the web server |
| `kuraki import <dir>` | Bulk-import a directory (`--dry-run`, `--watch`) — *M1* |
| `kuraki verify` | Re-checksum the library, report mismatches — *M2* |
| `kuraki version` | Print version |

## Architecture

- **Server:** Go, single static binary, embedded SvelteKit UI via `go:embed`.
- **Database:** SQLite (WAL) via pure-Go `modernc.org/sqlite`; FTS5 search; `goose` migrations with automatic pre-migration snapshots.
- **Storage:** plain filesystem, write-once originals, all access behind a `Storage` interface (S3 later).
- **Media:** libvips (govips) + ffmpeg behind a `Processor` interface, with a pure-Go fallback so it still builds anywhere.
- **Schema principles:** UUIDv7 keys, `owner_id` from day one, soft deletes, BLAKE3 hashes, `change_log` for future sync.

### On-disk library layout

```
kuraki-data/
├── kuraki.db                       # SQLite (WAL): metadata + pointers only
├── originals/2026/07/IMG_1234.jpg  # write-once, human-readable, never modified
├── derivatives/<ab>/<hash>_thumb.webp
├── trash/                          # 30-day retention
└── snapshots/kuraki-<ts>.db        # pre-migration backups
```

## Repository structure

```
kuraki/
├── cmd/
│   └── kuraki/            # CLI entrypoint (cobra): serve / import / verify / version
├── internal/
│   ├── app/              # composition root — wires config→db→storage→media→http
│   ├── config/          # zero-config defaults + env/flag resolution
│   ├── domain/          # core entities (Asset, User, …) — NO I/O, ever
│   ├── db/              # SQLite open (WAL), migrations, pre-migration snapshot
│   │   └── migrations/  # embedded, versioned goose SQL (schema v1+)
│   ├── storage/         # Storage interface + filesystem impl (S3 later)
│   ├── media/           # Processor interface + libvips/pure-Go backends, ffmpeg, EXIF
│   ├── importer/        # bulk import: walk, hash, dedup, resume (M1)
│   ├── auth/            # sessions, argon2id, rate limiting (M2)
│   └── httpapi/         # chi router, handlers, middleware
│       └── assets/      # embedded web UI build (go:embed)
├── web/                 # SvelteKit source, built into internal/httpapi/assets (M1)
├── docs/                # PRD / BRD (kept local, gitignored)
├── .github/
│   ├── workflows/       # CI: test + cross-compile matrix + Docker publish
│   └── ISSUE_TEMPLATE/  # bug / feature templates
├── Dockerfile           # multi-stage; runtime bundles libvips + ffmpeg
├── Makefile             # dev shortcuts (build, test, run, docker)
├── go.mod
├── LICENSE              # AGPL-3.0
├── README.md
└── ROADMAP.md           # milestone & progress tracker
```

**Architectural rule:** `internal/domain` performs no I/O. All file access goes through `storage.Storage`; all image work through `media.Processor`. This keeps the future S3 backend and libvips-optionality cheap to add.

## Development

Requires **Go 1.26+**. libvips and ffmpeg are only needed for the full media pipeline (or use Docker).

```sh
make build        # pure-Go binary -> ./bin/kuraki
make run          # build + serve
make test         # go test -race ./...
make vet          # go vet ./...
make build-vips   # libvips-backed build (needs libvips-dev; -tags vips)
make docker       # build the container image
```

**Build tags:** the default build is pure-Go (`CGO_ENABLED=0`, portable). Build with `-tags vips` to link the libvips backend for fastest thumbnails and native HEIC/AVIF/RAW.

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## Roadmap

Phase 1 (personal backup & sync) → Phase 2 (multi-user & sharing) → Phase 3 (mobile & optional ML).
Full milestone breakdown and live status: **[ROADMAP.md](./ROADMAP.md)**.

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please **don't** open a public issue — see [SECURITY.md](./SECURITY.md).
Note: Kuraki intentionally has **no server-side E2EE** (it's a non-goal); the server reads your files to make thumbnails and search work.

## License

[GNU AGPL-3.0](./LICENSE) © Saransh. Matching the community norm (Immich/Ente) and protecting against closed-source cloud capture.
