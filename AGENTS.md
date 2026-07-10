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

A self-hosted photo & video backup server with a Google-Photos-style web library.
**Thesis: own your library** — originals kept intact on disk in a readable layout,
boring snapshot-protected upgrades, zero lock-in. Docker-first (libvips + ffmpeg
bundled). It targets the gap between Immich (heavy) and Ente (hard to self-host).
Phase 1 = single-owner personal backup.

## 2. Current state

- **Phase 1 (single-owner) is feature-complete and pushed** to `github.com/kuraki-app/kuraki`.
  Implemented and verified: zero-config server; CLI + drag-and-drop import via a background **queue**
  (retries, crash recovery, an **Activity** view with per-file errors); BLAKE3 dedup; **watch-folder**;
  **Google Takeout** sidecar import; libvips/pure-Go thumbnails + ffmpeg posters + EXIF; timeline,
  viewer (with in-browser video), FTS5 search, favorites, albums, "on this day", **Places** map +
  offline reverse geocoding, multi-select batch + zip export, **metadata editing** (date/GPS/caption
  with re-geocode, batch timezone shift), a library **stats** dashboard; trash + retention + `verify`;
  argon2id auth + login rate-limit; safe-upgrade snapshots; and serving perf (cache headers, gzip,
  SQLite tuning). See [CHANGELOG.md](./CHANGELOG.md) for the full list.
- **Builds & tests:** `go build ./...`, `go vet ./...`, `gofmt`, `go test -race ./...` all green;
  `npm run build` (web) clean. Cross-compiles linux/amd64+arm64, darwin/arm64, windows/amd64 (CGO off).
- **R1 media core (2026-07-10):** current import admission covers JPEG/PNG/GIF/WebP/HEIC/HEIF/AVIF/TIFF plus MP4/M4V/MOV/WebM. A per-asset capability flag now prevents the viewer from rendering known-incompatible originals: libvips/pure-Go creates image previews where possible, ffprobe identifies browser-compatible video codecs, and ffmpeg creates H.264/AAC playback derivatives otherwise. Failed derivatives remain downloadable and appear in Activity's Media health section. Cross-engine and libvips fixture certification remains env-gated.
- **Module path:** `github.com/kuraki-app/kuraki`. Migrations through `00011`.
- **Not browser-click-tested:** the SvelteKit UI compiles and serves and all endpoints are E2E-verified
  via curl, but no headless-browser pass has been run (per human request).
- **Env-gated / pending:** `-tags vips` build (needs libvips + `pkg-config`), HEIC out of the box,
  low-resource benchmark; plus roadmap items (slideshow, stacks, near-duplicate grouping,
  multi-user, mobile, optional ML).

## 3. Locked decisions (do NOT relitigate without human sign-off)

| Area | Decision |
|---|---|
| Language/server | Go server, embedded UI via `go:embed` |
| Frontend | SvelteKit + adapter-static (SPA), built into `internal/httpapi/assets/` |
| Database | `modernc.org/sqlite` (pure-Go, WAL, FTS5). Keep the DB layer CGO-free. |
| Migrations | `pressly/goose`, embedded, **append-only** |
| Media | libvips (govips) + ffmpeg behind `media.Processor`; pure-Go fallback |
| Build tags | default = pure-Go (`CGO_ENABLED=0`); `-tags vips` = libvips (CGO on) |
| Storage | filesystem behind `storage.Storage`; S3 later |
| IDs / schema | UUIDv7 PKs, `owner_id` on every asset, soft deletes, BLAKE3 hashes, `change_log` |
| License | AGPL-3.0 |
| Distribution | Docker image (bundles libvips+ffmpeg) primary; native binaries secondary |

## 4. Tech stack & key libraries

- Go 1.26 · cobra (CLI) · chi/v5 (HTTP) · goose/v3 (migrations) · modernc.org/sqlite
- `zeebo/blake3` (hash) · `evanoberholster/imagemeta` (EXIF) · `davidbyttow/govips`
  (libvips, behind `-tags vips`) · `google/uuid` (v7) · `golang.org/x/crypto/argon2` ·
  `golang.org/x/time/rate` (login limiter) · `golang.org/x/image` (pure-Go media)
- Frontend: SvelteKit + adapter-static, `@lucide/svelte`, `leaflet` +
  `leaflet.markercluster` (Places map). Embedded GeoNames dataset in `internal/geo/data`.

## 5. Repository map

```
cmd/kuraki/            CLI (cobra): serve / import / verify / healthcheck / version
internal/
  app/                 composition root — wires everything; owns server lifecycle + workers
  config/              zero-config defaults + KURAKI_* env resolution
  domain/              core entities — **NO I/O EVER**
  db/                  Open (WAL + perf pragmas), Migrate (+snapshot); migrations embedded (→ 00011)
  storage/             Storage interface + FS impl (write-once, atomic, traversal-safe)
  media/               Processor interface + purego.go fallback + vips.go tagged backend, ffmpeg, EXIF
  importer/            recursive import, BLAKE3 dedup, import_state resume, derivatives; Takeout + geocode
  takeout/             Google Takeout sidecar parsing (title-index fallback)
  geo/                 offline reverse geocoding (embedded GeoNames cities/countries)
  queue/               background import queue: worker, retries/backoff, crash recovery, jobs
  trash/               soft-delete, restore, retention purge
  verify/              integrity re-checksum
  auth/                argon2id password hashes + session IDs
  httpapi/             chi router, handlers, middleware; assets/ = embedded UI
web/                   SvelteKit SPA (routes: timeline/search/favorites/albums/memories/places/duplicates/stats/activity/archive/hidden/trash)
docs/                  PRD/BRD + local plans — gitignored, local only
```

## 6. Hard rules (these are invariants — violating them is a bug)

1. **`internal/domain` performs no I/O.** No `os.*`, no `database/sql`, no net.
   File access → `storage.Storage`; image work → `media.Processor`.
2. **Originals are write-once.** Never modify/rename/delete an original after
   import. `storage.FS.Write` refuses overwrite (`ErrExists`) — keep it that way.
3. **Migrations are append-only.** Never edit a released migration file; add a
   new `0000N_*.sql`. Every schema change must be safe under the auto-snapshot.
4. **Keep the DB layer CGO-free.** libvips CGO is fine in `media`; do not pull
   CGO into `db`/`storage`/`domain`.
5. **Default build must stay pure-Go.** Anything needing libvips goes behind
   `//go:build vips`. `go build ./...` (no tags) must always succeed without libvips.
6. **Weight is the product.** New dependencies and features need justification
   against Kuraki's scope. When unsure, ask the human / open an issue.
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

Config env: `KURAKI_DATA_DIR` (`./kuraki-data`), `KURAKI_ADDR` (`:3000`),
`KURAKI_TRASH_RETENTION_DAYS` (`30`), `KURAKI_THUMBNAIL_SIZE` (`512`).

## 8. Progress ledger (update this)

| Area | Status |
|---|---|
| Server foundation, import, media pipeline, web UI, auth, trash, verify, video | ✅ done |
| Places (map + offline geocoding), Takeout import, favorites/albums/memories, stats | ✅ done |
| Import queue + Activity + per-file errors, metadata editing, config options, serving perf | ✅ done |
| R1 media compatibility: explicit view state, safe preview/transcode fallback, media-health rebuild | ✅ done |
| R2: tags/hierarchical tags, saved searches, ratings, archive/hidden, external libraries, backup/restore | ✅ done |
| R2: duplicate review (exact + near-duplicate by hamming), stacks (RAW+JPEG / Live-Motion), whole-library export, scheduled integrity verification | ✅ done |
| R1/R2 exit criteria | ✅ met (Takeout + mounted folder re-import without metadata loss; backup/restore on clean instance; org actions on indexed queries) |
| R1 full fixture matrix across libvips and Chromium/Firefox/WebKit | ⬜ env-gated release certification |
| R2 remaining (nice-to-haves): XMP sidecars, non-destructive edit, burst grouping, slideshow/jump-to-date/grid-density/dark-mode/a11y polish | ⬜ roadmap |
| libvips-default Docker image / HEIC verified, low-resource benchmark | ⬜ env-gated |
| Multi-user & sharing (R3), mobile/desktop clients (R4), optional ML (R5), scale (R6) | ⬜ later phases |

Detailed history: [CHANGELOG.md](./CHANGELOG.md). Forward plan: [ROADMAP.md](./ROADMAP.md).

## 9. Next up (suggested order for M1)

1. Run M1 exit verification with a real mixed library (JPEG/HEIC/PNG/MP4), including
   timeline/viewer browsing on low-resource hardware.
2. Verify `make build-vips` / `go test -tags vips ./...` on a machine or container
   with `pkg-config` and libvips development packages installed.
3. If exit verification passes, mark M1 done and start M2 auth hardening/trash/verify.

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

- `HEAD` — **R2 completion: near-duplicate grouping, stacks, whole-library export, scheduled verify (Claude).**
  `GET /api/duplicates` now clusters exact **and** near-duplicates via union-find over hamming distance
  (`media.Hamming`, threshold 8) so re-encodes/crops/light edits group, not just identical phashes; the
  `/duplicates` page keeps the keep-both default and multi-select trash. **Stacks** (migration `00011`):
  `internal/stacks.Detect` pairs RAW+JPEG and Live/Motion (image+video) by owner+base-filename+capture-day
  with ≥2 distinct extensions, picks a primary (web-viewable image > image > video, tie-break size), runs at
  startup and after each import/queue batch; the timeline collapses to the primary (`stack_primary=1`), a
  `Layers` badge shows the count, and `GET /api/assets/:id/stack` returns members (viewer pages through them).
  **Whole-library export**: `GET /api/export` streams a date-foldered zip of every original (shared `streamZip`).
  **Scheduled integrity verification** (migration `00010`): `verify.RunAndRecord` writes an `integrity_runs`
  row; a 7-day scheduler (`app.startIntegrityScheduler`) runs it; `GET /api/integrity` + `POST /api/integrity/run`
  back a "last verified / Verify now" panel on the Stats dashboard. Also added a phash backfill from thumbnails.
  Verified E2E via curl (no headless browser, per request): near-dup clustering (exact + cropped group, distinct
  excluded), export zip structure, a clean integrity run recorded, stacks collapse (RAW+JPEG and Live/Motion →
  3 tiles not 5) with the stack endpoint returning members; **backup→restore round-trip** faithfully restores
  3 assets/originals/derivatives on a clean instance (R2 exit gate). Migrations now through `00011`.
  `go test -race ./...` + `npm run build` green. **R1 and R2 exit criteria are met.** Remaining are roadmap
  nice-to-haves (XMP sidecars, non-destructive edit, burst grouping, UI polish) and env-gated R1 3-browser
  certification. **No co-author trailer on commits (user request).**
- `HEAD~` — **R2 duplicate review (Claude).** `media.PerceptualHash` (dHash) computed from each image
  thumbnail during import (migration `00009` adds `phash` + partial index) with a startup backfill;
  `GET /api/duplicates` groups images sharing a perceptual hash (visually identical copies byte-dedup
  misses); a `/duplicates` page reviews groups with a keep-both default and multi-select move-to-trash.
  Verified E2E: two re-encoded copies (different bytes, same phash) group; deleting one resolves it.
  Migrations now through `00009`. Near-duplicate (hamming) grouping and stacks remain for R2.
- `HEAD~` — **Consolidated Codex branch + media-health rebuild (Claude).** Reviewed the Codex work
  (all builds/vets/tests green; migrations `00006`–`00008`; new `backup`/`external` packages; tags,
  saved searches, ratings, archive/hidden, external libraries, media compatibility). Fast-forwarded
  `main` to the `codex/roadmap-media-contract` branch and pushed (remote is now
  `kuraki-app/kuraki-photos`). Then implemented the roadmap's R1 "one-click retry/rebuild":
  `Importer.RebuildDerivatives` (regenerate thumbnail/poster/preview/playback from the stored original,
  clear resolved `media_issues`) + `POST /api/assets/:id/rebuild` + a Rebuild button on Activity's media
  health. Verified E2E (deleted thumb + issue → rebuild → thumb back, issue cleared). `go test -race` +
  `npm run build` green. **No co-author trailer on commits (user request).**
- Working tree — **R1 media compatibility core (Codex).** Added migration `00006` with `web_viewable` and durable `media_issues`; a `media.Capability` registry; ffprobe codec/dimension/duration inspection; bounded ffmpeg H.264/AAC playback derivatives; and image preview derivatives for non-web originals. The viewer uses `/preview` only when safe and shows an original-download fallback otherwise; Activity exposes durable media-health errors. Added unit/API/import tests, including a synthetic MPEG-4 input that is transcoded and verified in the in-app browser as a `/preview` source. `make check` and `npm run build` pass. Full libvips fixtures and multi-engine certification remain environment-gated. **Do not add a co-author trailer to commits: user explicitly requested none.**
- Working tree — **Product/compatibility planning audit (Codex).** Reviewed the shipped roadmap/changelog and the importer, media processors, HTTP serving, and Svelte viewer. Current extension admission is narrower than broad photo apps and direct browser rendering cannot guarantee HEIC/HEIF/TIFF/RAW or codec-dependent video playback. Replaced `ROADMAP.md` with a staged, lightweight product plan: R1 is a content-detected, fixture- and three-browser-tested media contract with safe previews and playback derivatives; R2 organization/migration/recovery; R3 household sharing; R4 mobile/desktop backup; R5 opt-in ML; R6 scale. Research references and explicit non-goals are in the roadmap. No production code changed.
- `HEAD` — **Import queue + serving perf (Claude).** New `internal/queue`: uploads staged to
  `data/staging/<job>`, enqueued in a `jobs` table (migration `00004`), processed by a background worker
  (`app.Queue.Start`) with retries/backoff and crash recovery; `POST /api/assets` now returns 202+job_id,
  `GET /api/jobs(+/:id)`, and the UI polls job progress. Fixed a clock-skew bug (use Go-generated
  `next_attempt_at`). Perf: immutable/long cache headers on originals + hashed UI assets, week cache on
  thumbnails, gzip middleware for JSON/UI, and SQLite `cache_size`/`mmap_size`/`temp_store` pragmas.
  All backend E2E-verified (headers/gzip confirmed via curl); `go test -race` + `npm run build` green.
  Note: **no browser harness** used (user asked to skip headless Chrome); UI compiles + serves but was
  not click-tested.
- `HEAD~` — **Near-term batch (Claude):** four roadmap "doable now" items. (1) **Google Takeout import**:
  new `internal/takeout` sidecar parser (title-index fallback for truncated names), applied on import
  (date authoritative, GPS/caption/favorite fill-in), `00003_description` migration + searchable captions.
  (2) **Configurable** trash retention + thumbnail size (`KURAKI_TRASH_RETENTION_DAYS`, `KURAKI_THUMBNAIL_SIZE`).
  (3) **Library dashboard**: `GET /api/stats` + `/stats` page. (4) **Metadata tools**: `PATCH /api/assets/:id`
  (date/GPS/caption + re-geocode + FTS refresh), `POST /api/assets/shift-time` (batch timezone), viewer edit form.
  All backend E2E-verified; `go test -race` + `npm run build` green. Deferred (noted to human): tags/saved-searches,
  duplicate review, import queue, slideshow, libvips-default Docker image.
- `HEAD~` — **Web experience + Places (Claude).** (1) Places backend: new `internal/geo` offline reverse
  geocoder (embedded GeoNames cities/countries, grid-indexed nearest-city), migration `00002_places`,
  geocode-on-import + startup backfill, place name on the asset DTO, and `GET /api/places` +
  `/api/places/summary`. (2) Frontend rebuilt into a multi-route SPA (`web/src/lib` api/stores/types +
  components `AssetGrid`/`Viewer`/`BatchBar`/`AlbumPicker`/`LibraryView`; routes for timeline/search/
  favorites/albums/albums[id]/memories/trash/places). Layout is `ssr=false, prerender=false` SPA; Go
  serves the fallback for deep routes. Leaflet added for the map. Verified: geocoder unit tests, Places
  API E2E, `go test ./...` green, `npm run build` clean, SPA + `_app` assets serve.
- `HEAD~` — **F-25 Docker polish (Claude):** container `HEALTHCHECK` via a hidden `kuraki healthcheck`
  self-probe (no curl/wget in image), non-root `kuraki` user, OCI labels, and root `docker-compose.yml`.
  Verified: healthcheck exits 0 when server up, 1 when down. **Backend for P0 + P1 is now complete;
  remaining work is frontend UI + env-gated (F-24 RAW, HEIC/vips, Pi) + docs site.**
- `HEAD~` — **P1 backend cont. (Claude):** F-23 batch **zip download** (`POST /api/assets/zip` streams a zip of
  selected originals) and **F-21 albums** full backend API (`/api/albums` CRUD + `/{id}/assets` add/remove).
  Both verified E2E, committed separately. Albums/map/video **UI** remain frontend follow-ups.
- `HEAD~` — **P1 backend (Claude), committed granularly:** F-20 watch-folder (`import --watch`),
  favorites (`POST /assets/:id/favorite` + `GET /favorites`), F-26 "on this day" (`GET /memories`),
  F-23 batch ops (`POST /assets/batch`). All verified E2E; fmt/vet/-race green. The whole prior M1+M2
  pile was also committed in 9 logical commits (deps→importer→verify→trash→auth→media→api→app→docs).
  **Not pushed yet** (no remote; visibility decision pending).
- Working tree — **M2 backend (Claude): F-10 trash, F-13 video, F-14 rate-limit, /metrics.**
  New `internal/trash` (delete/restore/purge + tests) with `DELETE /api/assets/:id`, `POST /:id/restore`,
  `GET /api/trash`, and a startup+daily purge janitor in `app`. `POST /api/assets` multipart upload runs the
  importer (added `Media` to httpapi.Deps). HTTP Range on `/original` via `http.ServeContent` (video seeking).
  Per-IP login limiter (`x/time/rate`, added dep) on `/api/login`. Real `/metrics` (runtime + library counts).
  All verified E2E (upload→2, delete→trash→restore, 206 range, 10-then-429, metrics). fmt/vet/-race green.
- Working tree — **Started M2 (Claude): F-12 `kuraki verify`.** New `internal/verify` package
  (re-hashes originals via `storage.Storage`, classifies OK/mismatch/missing/error), `App.Verify`,
  and CLI wiring (prints findings with path + expected/actual, exits non-zero on problems). Unit test +
  end-to-end verified (healthy→exit 0, corrupted original→MISMATCH + exit 1). fmt/vet/-race all green.
- Working tree — **Re-checked M1 end-to-end (Claude):** built + ran a real mixed import
  (JPEG/PNG/MP4 + a byte-duplicate) → verified dedup, write-once date tree, thumbs + ffmpeg
  poster, resume; then serve → setup/login → timeline/thumb/search/auth over HTTP. **Fixed a
  filename-search gap:** `ftsQuery` now emits FTS5 prefix terms (`"photo"*`) so `photo` matches
  `photo3.jpg` (F-09). `-tags vips` build fails locally only for missing pkg-config/libvips (not code).
- Working tree — Continued M1: added first-run setup/login/session APIs and UI,
  bounded importer progress/derivative workers, tagged govips WebP thumbnail/probe
  backend, viewer keyboard/progressive behavior, and visible-window timeline rendering.
- Working tree — Continued M1: pure-Go EXIF extraction, JPEG thumbnail generation,
  ffmpeg poster support, asset/search/original/thumb APIs, SvelteKit static UI,
  Docker Node build stage, and browser verification of desktop/mobile empty state.
- Working tree — Added first M1 importer slice: BLAKE3/UUID deps, recursive import
  package, write-once original storage, DB/FTS/import_state writes, dry-run mode,
  `kuraki import <dir>` wiring, and importer tests.
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
