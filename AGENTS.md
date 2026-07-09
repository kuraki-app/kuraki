# AGENTS.md — shared context for AI agents working on Kuraki

> **Read this first.** This file is the coordination point for any agent (Codex,
> Claude, Cursor, etc.) working on this repo. It captures current state, the
> rules you must follow, and how to hand off cleanly to the next agent.
> Keep it accurate: **when you finish a unit of work, update the "Progress
> ledger" and "Handoff log" below in the same commit.**
>
> Human-facing milestone tracker: [ROADMAP.md](./ROADMAP.md).
> Full product rationale: `docs/` (PRD/BRD) — local only, gitignored.

---

## 1. What Kuraki is (30-second version)

A lightweight, self-hosted photo backup & sync server. **Thesis: operational
calm on minimal hardware** — one binary, plain-file storage, runs on a Raspberry
Pi, boring upgrades, zero lock-in. It targets the gap between Immich (heavy) and
Ente (hard to self-host). Phase 1 = single-owner personal backup.

## 2. Current state (as of commit `06ca1ed`)

- **Milestone:** M0 (scaffold) **complete**. M1 (core alpha) **not started**.
- **Builds & tests:** `go build ./...` clean, `go test -race ./...` green.
- **Cross-compiles:** linux/amd64, linux/arm64, darwin/arm64, windows/amd64 (CGO off).
- **Runtime verified:** `kuraki serve` boots zero-config, runs migrations (WAL),
  serves `/healthz`, `/api/status`, and the embedded UI shell.
- **Module path:** `github.com/saranshhardaha/kuraki`.
- **Not yet present:** `web/` (SvelteKit UI), `internal/importer`, `internal/auth`,
  the libvips backend (`internal/media/vips.go`), EXIF extraction, real handlers.

## 3. Locked decisions (do NOT relitigate without human sign-off)

| Area | Decision |
|---|---|
| Language/server | Go, single binary, embedded UI via `go:embed` |
| Frontend | SvelteKit + adapter-static (SPA), built into `internal/httpapi/assets/` |
| Database | `modernc.org/sqlite` (pure-Go, WAL, FTS5). Keep the DB layer CGO-free. |
| Migrations | `pressly/goose`, embedded, **append-only** |
| Media | libvips (govips) + ffmpeg behind `media.Processor`; pure-Go fallback |
| Build tags | default = pure-Go (`CGO_ENABLED=0`); `-tags vips` = libvips (CGO on) |
| Storage | plain filesystem behind `storage.Storage`; S3 later |
| IDs / schema | UUIDv7 PKs, `owner_id` on every asset, soft deletes, BLAKE3 hashes, `change_log` |
| License | AGPL-3.0 |
| Distribution | Docker image (bundles libvips+ffmpeg) primary; native binaries secondary |

## 4. Tech stack & key libraries

- Go 1.26 · cobra (CLI) · chi/v5 (HTTP) · goose/v3 (migrations) · modernc.org/sqlite
- Planned in M1: `zeebo/blake3` (hash), `evanoberholster/imagemeta` (EXIF),
  `davidbyttow/govips` (vips, behind tag), `google/uuid` (v7),
  `golang.org/x/crypto/argon2` (M2 auth), `sqlc` (typed queries, optional).

## 5. Repository map

```
cmd/kuraki/            CLI entrypoint (cobra): serve/import/verify/version
internal/
  app/                 composition root — wires everything; owns server lifecycle
  config/              zero-config defaults + KURAKI_* env/flag resolution
  domain/              core entities — **NO I/O EVER**
  db/                  Open (WAL), Migrate (+snapshot); migrations/*.sql embedded
  storage/             Storage interface + FS impl (write-once, atomic, traversal-safe)
  media/               Processor interface + purego.go (fallback); vips.go = TODO (M1)
  httpapi/             chi router, handlers, middleware; assets/ = embedded UI
  importer/            TODO (M1): walk, hash, dedup, resume
  auth/                TODO (M2): sessions, argon2id, rate limit
web/                   TODO (M1): SvelteKit source
docs/                  PRD/BRD — gitignored, local only
```

## 6. Hard rules (these are invariants — violating them is a bug)

1. **`internal/domain` performs no I/O.** No `os.*`, no `database/sql`, no net.
   File access → `storage.Storage`; image work → `media.Processor`.
2. **Originals are write-once (F-03).** Never modify/rename/delete an original
   after import. `storage.FS.Write` refuses overwrite (`ErrExists`) — keep it that way.
3. **Migrations are append-only.** Never edit a released migration file; add a
   new `0000N_*.sql`. Every schema change must be safe under the auto-snapshot.
4. **Keep the DB layer CGO-free.** libvips CGO is fine in `media`; do not pull
   CGO into `db`/`storage`/`domain`.
5. **Default build must stay pure-Go.** Anything needing libvips goes behind
   `//go:build vips`. `go build ./...` (no tags) must always succeed without libvips.
6. **Weight is the product.** New dependencies and features need justification
   against the "runs on a Pi" thesis. When unsure, ask the human / open an issue.
7. **Structured logging only** (`log/slog`); no stray `fmt.Println` in libraries.
8. **Wrap errors** with context: `fmt.Errorf("pkg: doing X: %w", err)`.

## 7. Commands

```sh
make build        # pure-Go binary -> ./bin/kuraki   (CGO_ENABLED=0)
make build-vips   # libvips backend (needs libvips-dev; -tags vips)
make run          # build + serve on :3000
make test         # go test -race ./...
make vet          # go vet ./...
make fmt          # gofmt -w -s .
make check        # fmt + vet + test  (run before every commit)
make cross        # release binaries for all platforms -> ./dist
make docker       # build container image
```

Config: `--data-dir`/`KURAKI_DATA_DIR` (default `./kuraki-data`), `--addr`/`KURAKI_ADDR` (default `:3000`).

## 8. Progress ledger (update this)

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold (config, db+schema, storage/media ifaces, CLI, http, CI, docker) | ✅ done |
| M1 | Core alpha F-01…F-09 (import, thumbnails, timeline, viewer, search, UI) | ⬜ not started |
| M2 | Beta F-10…F-14 (trash, verify, video, auth hardening) | ⬜ not started |
| M3 | v1.0 (benchmarks, hardening, launch) | ⬜ not started |

Fine-grained checkboxes live in [ROADMAP.md](./ROADMAP.md) — keep both in sync.

## 9. Next up (suggested order for M1)

1. Add deps: `zeebo/blake3`, `evanoberholster/imagemeta`, `google/uuid`.
2. `internal/importer`: recursive walk → BLAKE3 stream-hash → dedup (unique index)
   → EXIF date → write original to `originals/YYYY/MM/` → insert asset + FTS row →
   resume via `import_state`; support `--dry-run`; progress bar. Wire `kuraki import`.
3. `internal/media/vips.go` (`//go:build vips`) + `internal/app/processor_vips.go`:
   govips Thumbnail (WebP) + Probe; ffmpeg poster (feature-detected). Bounded worker pool.
4. EXIF extraction in the pure-Go `Probe` too (taken_at/camera/GPS).
5. HTTP handlers: `GET /api/assets` (cursor, day-grouped), `/api/assets/:id`,
   `/thumb`, `/original`, `/api/search`. Repository layer over sqlc or database/sql.
6. `web/`: SvelteKit static app; virtualized timeline + viewer; build into
   `internal/httpapi/assets/`; add Node stage to Dockerfile.
7. First-run admin setup + basic login (hardened in M2).

## 10. Coordination protocol (multi-agent)

- **Before starting:** read this file + `git log --oneline -15` to see recent work.
- **One logical change per branch/commit.** Branch from `main`
  (`feat/…`, `fix/…`). Commit style: `type: imperative summary` + why.
- **Before committing:** `make check` must pass.
- **After finishing:** update §2 (current state), §8 (ledger), the relevant
  ROADMAP checkboxes, and append a line to §11 — in the **same commit**.
- **Don't** break the hard rules in §6, edit released migrations, or add CGO to
  the default build. If a decision in §3 seems wrong, flag it for the human;
  don't silently change it.
- Co-author trailer for AI commits: `Co-Authored-By: <agent> <email>`.

## 11. Handoff log (append newest at top)

- `06ca1ed` — Renamed module/org `saranshh` → `saranshhardaha` (correct GitHub user).
- `4824823` — Added OSS scaffolding (README, CONTRIBUTING, SECURITY, CoC, CHANGELOG,
  issue/PR templates, Makefile, .editorconfig, CODEOWNERS).
- `a94c679` — Added ROADMAP.md tracker.
- `f9602ef` — **M0 scaffold**: zero-config server, SQLite+WAL+goose+snapshot, schema v1,
  storage/media interfaces, cobra CLI, chi HTTP + embedded UI, Docker + CI, tests.

## 12. Environment gotchas

- **libvips is NOT installed** on the current dev machine; ffmpeg IS. The default
  build works without libvips. Use Docker or install `libvips-dev` for `-tags vips`.
- macOS BSD `sed` lacks `\b`; use explicit patterns or the Edit tool.
- Don't query codegraph/indexers in the same turn you edit a file (watcher lag).
- The file watcher and `docs/` are gitignored — never commit `docs/` or `kuraki-data/`.
