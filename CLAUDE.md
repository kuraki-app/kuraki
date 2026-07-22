# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion doc

`AGENTS.md` is the authoritative, continuously-updated coordination file for this repo — current state (§2), locked decisions (§3), the progress ledger (§8), and the handoff log (§11). **Read it before starting nontrivial work, and update §2/§8/§11 in the same commit that finishes a unit of work.** This file is the stable orientation; AGENTS.md is the living state.

## What this is

Kuraki is a self-hosted photo & video backup server (AGPL-3.0). A single Go binary embeds a SvelteKit SPA and can serve the whole app from one port (the Docker image additionally fronts the UI with Caddy — see Runtime shape below). There is also an Expo/React Native mobile client (`mobile/`) for camera-roll backup and library browsing. Three surfaces — `internal/` (Go server), `web/` (SvelteKit), `mobile/` (Expo) — are all CI-gated.

## Commands

Backend (from repo root, via `Makefile`):

```sh
make check        # fmt + vet + test — run before every commit
make test         # go test -race ./...
make build        # pure-Go binary -> ./bin/kuraki (CGO_ENABLED=0)
make build-vips   # libvips backend (needs libvips-dev + pkg-config; -tags vips)
make dev          # API :3000 + Vite UI :5173, hot reload (scripts/dev.sh) — open :5173
make start        # build web + binary, one production-like process on :3000
```

Run a single Go test: `go test -race ./internal/importer -run TestName`.
Note: `make` targets use `GO_PACKAGES` (`go list ./...` minus `node_modules`) — Expo fixtures under `mobile/` contain Go files that must not be treated as project packages.

Web (`cd web`): `npm run dev` (Vite, proxies /api to :3000) · `npm run build` (outputs embedded assets into `internal/httpapi/assets` via `go:embed`).

Mobile (`cd mobile`): `npm run ios` / `npm run android` · `npm run lint` (`expo lint`) · `npx tsc --noEmit` (typecheck).

**CI (`.github/workflows/ci.yml`) gates six jobs:** vet+`go test -race`, web build, mobile `tsc --noEmit` + `expo lint`, pure-Go cross-compile, Docker image, and a **media-contract job** that installs libvips and runs `CGO_ENABLED=1 go test -race -tags vips ./...`. That last one is the only place `-tags vips` code is exercised (this machine has no libvips), so treat `vips.go` changes as untestable locally — build them in Docker or expect CI to be the first check. Some tests self-skip when `ffmpeg`/`tesseract` are absent rather than failing.

## Architecture

**Composition root: `internal/app`** wires every package together, owns the server lifecycle and background workers (import queue, trash-purge janitor, integrity scheduler, capture-session janitor). Start here to trace how a request or job flows.

**Layering / dependency direction:**
- `internal/domain` — core entities, **no I/O ever** (no `os`, `database/sql`, `net`). File access goes through `storage.Storage`; image work through `media.Processor`.
- `internal/storage` — `Storage` interface + write-once, atomic, traversal-safe FS impl. `FS.Write` refuses overwrite (`ErrExists`).
- `internal/db` — `modernc.org/sqlite` (pure-Go, WAL, FTS5), perf pragmas, goose migrations (embedded, **append-only**), auto-snapshot before every schema change. Keep this layer CGO-free.
- `internal/media` — `Processor` interface with a pure-Go fallback (`purego.go`) and a libvips backend behind `//go:build vips` (`vips.go`); ffmpeg posters/transcodes; EXIF; perceptual hashing.
- `internal/httpapi` — chi router, handlers, middleware; `assets/` holds the embedded built UI. Filters live in `filters.go` (`parseAssetFilters` + `respondFiltered`) — the one filter language behind `/api/search` and the device read endpoints.
- Feature packages: `importer` (recursive import, BLAKE3 dedup, resume, derivatives, Takeout+geocode), `queue` (background import jobs with retry/backoff/crash recovery), `takeout`, `geo` (offline reverse geocoding, embedded GeoNames), `trash`, `verify`, `auth` (argon2id + sessions), `ocr` (opt-in tesseract via exec), `duplicates`, `stacks`, `backup`, `external`.

**Data dir layout** (everything the library needs lives under `KURAKI_DATA_DIR`): `kuraki.db` (metadata + pointers only) · `originals/YYYY/MM/` (write-once) · `derivatives/<id>/` (thumbs, posters, transcodes) · `staging/` (uploads awaiting the queue) · `trash/` (retention window) · `snapshots/` (pre-migration DB copies). The DB stores pointers, never bytes.

**CLI: `cmd/kuraki`** (cobra, all in `main.go`) — `serve` / `import` / `verify` / `backup` / `restore` / `passwd` / `healthcheck` / `version`. `passwd` resets a password offline and is the recovery path when locked out of the web UI; `healthcheck` is the container's HEALTHCHECK probe.

**Runtime shape in Docker:** one container, one process, one origin. `scripts/docker-entrypoint.sh` `exec`s `kuraki serve` on `:3000`, which serves the API, media, `/healthz`, `/metrics`, `/download/*`, and the embedded SvelteKit UI (including first-run setup) — all from a single origin. The UI boots under the strict CSP via a per-request script nonce (`spaHandler`/`serveSPADocument` in `internal/httpapi`); there is no in-container Caddy. Any non-`serve` argument passes straight through to the CLI, which is why `docker compose exec kuraki kuraki import …` still works. For internet exposure, front the container with the HTTPS reverse proxy in `deploy/` (which proxies to `:3000`).

## Invariants (violating these is a bug)

1. `internal/domain` performs no I/O.
2. **Originals are write-once** — never modify/rename/delete an original after import; keep `FS.Write`'s overwrite refusal.
3. **Migrations are append-only** — never edit a released `0000N_*.sql`; add a new one. Every schema change must be safe under the auto-snapshot.
4. **DB/storage/domain stay CGO-free.** libvips CGO is confined to `media` behind `-tags vips`.
5. **Default build must stay pure-Go** — `go build ./...` (no tags) always succeeds without libvips. Anything needing libvips goes behind `//go:build vips`.
6. Structured logging only (`log/slog`); wrap errors with context (`fmt.Errorf("pkg: doing X: %w", err)`).

## Build tags & environment

Default build is `CGO_ENABLED=0` pure-Go; `-tags vips` (CGO on) adds the libvips backend for broader image decoding (HEIC/AVIF/etc.). **libvips is not installed on this dev machine; ffmpeg is** — use Docker or install `libvips-dev` for the vips build. The Docker image bundles libvips + ffmpeg + tesseract.

Config is zero-config with `KURAKI_*` env overrides (`internal/config`; precedence defaults < env < flags). Full table in README; the ones that change behavior most: `KURAKI_DATA_DIR` (`./kuraki-data`), `KURAKI_ADDR` (`:3000`), `KURAKI_TRASH_RETENTION_DAYS` (`30`), `KURAKI_THUMBNAIL_SIZE` (`512`), `KURAKI_OCR` (`off`), `KURAKI_SECURE_COOKIES` (`off`), `KURAKI_TRUST_PROXY` (`off` — trusting `X-Forwarded-For` when *not* behind a proxy silently weakens the login rate limit), `KURAKI_METRICS_TOKEN`, `KURAKI_BACKUP_DIR`/`_INTERVAL_HOURS`/`_KEEP` (unattended backups), `KURAKI_ANDROID_APK`.

## Conventions

- One logical change per branch/commit; branch from `main` (`feat/…`, `fix/…`). Commit style: `type: imperative summary`.
- `make check` must pass before committing. This repo has favored **batching changes** (avoid tiny sub-8-file commits unless told).
- Never commit `docs/` or `kuraki-data/` (both gitignored).
- Locked decisions (§3 of AGENTS.md) — Go+embedded UI, SvelteKit adapter-static SPA, pure-Go sqlite, goose, media behind `Processor`, UUIDv7 PKs — are not to be relitigated without human sign-off.
