# 蔵 Kuraki

**Lightweight, self-hosted photo backup & sync — one binary, plain files, runs on a Raspberry Pi.**

Kuraki fills the gap between Immich (feature-rich but resource-hungry, multi-container) and Ente (efficient but painful to self-host). It ships as a single artifact with an embedded database and web UI, stores your photos as **plain files on the filesystem**, and is built for **operational calm on minimal hardware**.

> One-line positioning: *"Google Photos for your own hardware — without needing a datacenter to run it."*

## Status

🚧 Early development — **Phase 1 (personal backup & sync)**. See `docs/` for the PRD/BRD and the build plan.

- ✅ **M0 — scaffold**: zero-config server, SQLite (WAL) + versioned migrations with pre-migration snapshots, filesystem storage & media interfaces, embedded UI shell, cross-platform build + Docker + CI.
- ⏳ **M1 — core alpha** (F-01…F-09): CLI bulk import, thumbnails, timeline, viewer, search.
- ⏳ **M2 — beta** (F-10…F-14): trash, verify, video, auth hardening.

## Quick start

```sh
# Build (pure-Go, no external deps)
go build -o kuraki ./cmd/kuraki

# Run — zero config; creates ./kuraki-data and serves on :3000
./kuraki serve
```

Or with Docker (bundles libvips + ffmpeg for full format support):

```sh
docker build -t kuraki .
docker run -p 3000:3000 -v "$PWD/kuraki-data:/data" kuraki
```

Then open <http://localhost:3000>.

## Commands

| Command | Description |
|---|---|
| `kuraki serve` | Start the web server (flags: `--addr`, `--data-dir`) |
| `kuraki import <dir>` | Bulk-import a directory (M1) |
| `kuraki verify` | Re-checksum the library (M2) |
| `kuraki version` | Print version |

Environment: `KURAKI_DATA_DIR`, `KURAKI_ADDR`.

## Architecture

- **Server:** Go, single static binary, embedded SvelteKit UI via `go:embed`.
- **Database:** SQLite (WAL) via pure-Go `modernc.org/sqlite`; FTS5 search; versioned `goose` migrations with automatic pre-migration snapshots.
- **Storage:** plain filesystem, write-once originals, all access behind a `Storage` interface (S3 later).
- **Media:** libvips (govips) + ffmpeg behind a `Processor` interface, with a pure-Go fallback so it still builds anywhere.
- **Principles:** UUIDv7 keys, `owner_id` from day one, soft deletes, BLAKE3 hashes, `change_log` for future sync.

## License

[AGPL-3.0](./LICENSE).
