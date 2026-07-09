# Kuraki — Build Roadmap & Progress Tracker

> **Living document.** This is the single source of truth for what's built and what's next.
> Update the checkboxes and the "Status" line as work completes. Full rationale lives in
> `docs/` (PRD/BRD) — kept local, gitignored.
>
> 🤖 **AI agents:** read [AGENTS.md](./AGENTS.md) first — it holds the hard rules,
> commands, and the multi-agent coordination protocol. Keep it in sync with this file.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · 🔒 locked decision

**Status:** M0 ✅ · M1 ✅ · **M2 backend ✅** · **P1 backend in progress** — watch-folder (F-20), favorites, "on this day" (F-26), batch ops (F-23) done. Remaining: frontend (video player, albums UI, map, zip download), docs site, HEIC/Pi verification.

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
- [x] Scaffold SvelteKit app under `web/` (adapter-static, TypeScript, Vite)
- [x] Build pipeline outputs to `internal/httpapi/assets/` for `go:embed` (**F-01**)
- [x] Add Node build stage to Dockerfile before Go build

### Media backend
- [x] `internal/media/vips.go` (`//go:build vips`) — govips Thumbnail (WebP) + Probe
- [x] `internal/app/processor_vips.go` (`//go:build vips`) — wire libvips backend
- [x] EXIF extraction (`evanoberholster/imagemeta`): taken_at, camera, GPS
- [x] ffmpeg poster generation, feature-detected (**F-13 groundwork**)
- [x] Bounded worker pool for thumbnails (GOMAXPROCS-aware, configurable) — Pi-safe (**F-07**)

### Import & storage (F-03, F-04, F-05)
- [x] `internal/importer` — recursive walk, ext filter
- [x] BLAKE3 stream-hash (`zeebo/blake3`) + dedup via `assets` unique index (**F-05**)
- [x] EXIF-date organization → `originals/YYYY/MM/` write-once (**F-03**)
- [x] Resume-on-interrupt via `import_state`; `--dry-run`; progress bar (**F-04**)
- [x] Populate `assets_fts` on import
- [x] `kuraki import <dir>` wired to command

### API & UI (F-06, F-08, F-09)
- [x] `GET /api/assets` — cursor-paginated, day/month grouped timeline
- [x] `GET /api/assets/:id`, `/original`, `/thumb?size=` handlers
- [x] `GET /api/search?q=&from=&to=&type=&camera=` over FTS5 (**F-09**)
- [x] Timeline UI — bounded visible window, infinite scroll, responsive grid (**F-06**)
- [x] Photo viewer — progressive full-size, EXIF panel, keyboard nav, download (**F-08**)
- [x] First-run admin setup flow + login (basic; hardened in M2) (**F-02**)

### M1 exit
- [~] Import a real mixed library, browse timeline + viewer — **JPEG/PNG/MP4 verified end-to-end locally**
  (import → BLAKE3 dedup → thumbnails + video poster → `/api/assets` timeline → thumb serving →
  prefix search → first-run setup + session auth). HEIC + actual Pi-class hardware still pending.
- [ ] Verify `-tags vips` build in an environment with `pkg-config` + libvips installed (fails locally only
  because libvips/pkg-config absent — not a code error; govips dep present)
- [x] `go test -race ./...` green
- [x] Fixed: filename search now uses FTS5 prefix matching so `photo` finds `photo3.jpg` (F-09)

---

## M2 — Beta hardening (F-10…F-14)

_Backend complete & verified end-to-end. Remaining: in-browser `<video>` player UI (frontend), docs site, HEIC/Pi verification._

- [x] **F-10** Trash: `internal/trash` (delete → `trash/`, restore, 30-day retention, purge janitor at
  startup + daily); `DELETE /api/assets/:id`, `POST /:id/restore`, `GET /api/trash`. Verified (delete→trash→restore).
- [x] **F-11** Auto pre-migration snapshot (M0) runs + logs before every migrate; trash janitor logs purges
- [x] **F-12** `kuraki verify` — re-checksums originals via `storage.Storage`, reports MISMATCH
  (path + expected/actual hash), MISSING, and ERROR; exits non-zero on any problem. `internal/verify`
  package + `App.Verify` + CLI. Verified end-to-end (healthy→exit 0; corrupted original→flagged, exit 1).
- [~] **F-13** Video: `POST /api/assets` multipart upload → importer, ffmpeg poster, HTTP **Range** on
  `/original` for seeking. Backend done + verified (206 partial content). In-browser `<video>` player UI = frontend follow-up.
- [x] **F-14** Auth hardening — HttpOnly/SameSite cookies + argon2id (M1) + per-IP login **rate limit**
  (`x/time/rate`, ~10 then 429). Verified (10 allowed → 429).
- [x] `/metrics` real metrics — mem/goroutines/uptime/GC + `assets_total`/`assets_trashed`/`library_bytes`
- [ ] Docs site + install demo GIF; 50 external installs target

---

## M3 — v1.0 (hardening & launch)

- [ ] Benchmarks vs Immich published (idle RAM <100MB, 10k import on Pi 4 without UI downtime)
- [ ] Semver commitment; zero open data-loss bugs
- [ ] Launch posts (X / HN / r/selfhosted)

---

## P1 — Fast-follows (post-beta, not on critical path)

- [x] **F-20** Watch-folder ingestion — `kuraki import --watch [--watch-interval]` rescans and auto-imports
  new files (import_state makes rescans cheap; pairs with Syncthing/rsync). Verified.
- [ ] **F-21** Albums UI (schema already ships in v1)
- [ ] **F-22** Map view from GPS EXIF (client clustering, OSM tiles) — frontend
- [~] **F-23** Multi-select batch ops — `POST /api/assets/batch` (delete/restore/favorite/unfavorite) done + verified.
  Batch **zip download** still pending.
- [ ] **F-24** RAW import + embedded-preview extraction
- [ ] **F-25** Docker image polish as alternative install path
- [x] **F-26** "On this day" memories — `GET /api/memories` (today's month/day across years, optional `?date=`). Verified.
- [x] **Favorites** — `POST /api/assets/:id/favorite` toggle + `GET /api/favorites` feed. Verified.

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
