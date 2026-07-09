# Kuraki — Build Roadmap & Progress Tracker

> **Living document.** This is the single source of truth for what's built and what's next.
> Update the checkboxes and the "Status" line as work completes. Full rationale lives in
> `docs/` (PRD/BRD) — kept local, gitignored.
>
> 🤖 **AI agents:** read [AGENTS.md](./AGENTS.md) first — it holds the hard rules,
> commands, and the multi-agent coordination protocol. Keep it in sync with this file.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · 🔒 locked decision

**Status:** M0 complete ✅ · **M1 in progress** · last updated after M0 scaffold commit.

---

## 🔒 Locked decisions

| Decision | Choice |
|---|---|
| Frontend | SvelteKit + adapter-static (SPA), embedded via `go:embed` |
| Media pipeline | libvips (govips) + ffmpeg behind a `Processor` interface; pure-Go fallback |
| Distribution | Docker image (bundles libvips+ffmpeg) primary; native binaries from CI secondary |
| License | AGPL-3.0 |
| Database | `modernc.org/sqlite` (pure-Go, WAL, FTS5) |
| Build tags | default = pure-Go/CGO-off; `-tags vips` = libvips backend (CGO on) |

---

## M0 — Scaffold ✅ (committed)

- [x] `git init`, `.gitignore` (ignores `docs/` + artifacts), AGPL-3.0 `LICENSE`, `go.mod`
- [x] `internal/config` — zero-config defaults + `KURAKI_*` env/flag overrides (**F-02**)
- [x] `internal/db` — WAL open, embedded goose migrations, **schema v1**, pre-migration snapshot (**F-11 infra**)
- [x] `internal/storage` — `Storage` interface + write-once atomic `FS` impl (**F-03 groundwork**)
- [x] `internal/media` — `Processor` interface + pure-Go fallback backend
- [x] `cmd/kuraki` — cobra CLI (`serve`/`import`/`verify`/`version`) + `internal/app` wiring
- [x] `internal/httpapi` — chi router, `/healthz`, `/api/status`, embedded UI shell + SPA fallback
- [x] Dockerfile (libvips+ffmpeg runtime) + `.dockerignore` + GitHub Actions CI (test/race + cross-compile matrix + GHCR)
- [x] Unit tests (config, db migrate/snapshot, storage write-once/dedup/traversal) — `go test -race ./...` green
- [x] Verified: cross-compile linux/amd64+arm64, darwin/arm64, windows/amd64

---

## M1 — Core alpha (F-01…F-09)

### Frontend
- [ ] Scaffold SvelteKit app under `web/` (adapter-static, TypeScript, Vite)
- [ ] Build pipeline outputs to `internal/httpapi/assets/` for `go:embed` (**F-01**)
- [ ] Add Node build stage to Dockerfile before Go build

### Media backend
- [ ] `internal/media/vips.go` (`//go:build vips`) — govips Thumbnail (WebP) + Probe
- [ ] `internal/app/processor_vips.go` (`//go:build vips`) — wire libvips backend
- [ ] EXIF extraction (`evanoberholster/imagemeta`): taken_at, camera, GPS
- [ ] ffmpeg poster generation, feature-detected (**F-13 groundwork**)
- [ ] Bounded worker pool for thumbnails (GOMAXPROCS-aware, configurable) — Pi-safe (**F-07**)

### Import & storage (F-03, F-04, F-05)
- [ ] `internal/importer` — recursive walk, ext filter
- [ ] BLAKE3 stream-hash (`zeebo/blake3`) + dedup via `assets` unique index (**F-05**)
- [ ] EXIF-date organization → `originals/YYYY/MM/` write-once (**F-03**)
- [ ] Resume-on-interrupt via `import_state`; `--dry-run`; progress bar (**F-04**)
- [ ] Populate `assets_fts` on import
- [ ] `kuraki import <dir>` wired to command

### API & UI (F-06, F-08, F-09)
- [ ] `GET /api/assets` — cursor-paginated, day/month grouped timeline
- [ ] `GET /api/assets/:id`, `/original`, `/thumb?size=` handlers
- [ ] `GET /api/search?q=&from=&to=&type=&camera=` over FTS5 (**F-09**)
- [ ] Timeline UI — virtualized infinite scroll, responsive grid (**F-06**)
- [ ] Photo viewer — progressive full-size, EXIF panel, keyboard nav, download (**F-08**)
- [ ] First-run admin setup flow + login (basic; hardened in M2) (**F-02**)

### M1 exit
- [ ] Import a real mixed library (JPEG/HEIC/PNG/MP4), browse timeline + viewer on Pi-class hardware
- [ ] `go test -race ./...` green

---

## M2 — Beta hardening (F-10…F-14)

- [ ] **F-10** Trash: soft-delete → `trash/`, 30-day retention, restore endpoint, purge job
- [ ] **F-11** Finalize safe-upgrade UX (snapshot verified before migrate; surfaced in logs)
- [ ] **F-12** `kuraki verify` — re-checksum library, report path + expected/actual on mismatch
- [ ] **F-13** Video: upload, ffmpeg poster, in-browser playback of web-compatible formats
- [ ] **F-14** Auth hardening — session cookies (HttpOnly/SameSite), argon2id, login rate limit (11th attempt blocked)
- [ ] `/metrics` real metrics (idle RAM, import counters)
- [ ] Docs site + install demo GIF; 50 external installs target

---

## M3 — v1.0 (hardening & launch)

- [ ] Benchmarks vs Immich published (idle RAM <100MB, 10k import on Pi 4 without UI downtime)
- [ ] Semver commitment; zero open data-loss bugs
- [ ] Launch posts (X / HN / r/selfhosted)

---

## P1 — Fast-follows (post-beta, not on critical path)

- [ ] **F-20** Watch-folder ingestion (pairs with Syncthing/rsync)
- [ ] **F-21** Albums UI (schema already ships in v1)
- [ ] **F-22** Map view from GPS EXIF (client clustering, OSM tiles)
- [ ] **F-23** Multi-select batch ops (zip download, delete, favorite)
- [ ] **F-24** RAW import + embedded-preview extraction
- [ ] **F-25** Docker image polish as alternative install path
- [ ] **F-26** "On this day" memories view

---

## Phase 2 — Sharing (Q2–Q3 2027)

- [ ] Multi-user accounts (owner_id already on every row — **F-30**)
- [ ] Albums UI complete
- [ ] Public share links (token-based access — **F-31**)

## Phase 3 — Mobile & ML (Q4 2027+)

- [ ] Flutter mobile app with background backup (sync API: change_log + per-device cursors — **F-33**)
- [ ] Optional ML sidecar: CLIP semantic search + faces (embedding BLOBs reserved — **F-32**)
- [ ] S3/object storage backend behind `Storage` interface (**F-34**)
- [ ] Postgres driver for hosted/multi-tenant scale (**F-35**)

---

## Open questions still to resolve

- [ ] HEIC/HEIF decode strategy across platforms (libvips build flags) — spike in M1
- [ ] Name availability: GitHub org / domain / trademark for "Kuraki" — before public beta
- [ ] Opt-in anonymous version-check ping — decide with community
