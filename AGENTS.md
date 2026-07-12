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
boring snapshot-protected upgrades, zero lock-in. Docker-first (ffmpeg bundled;
libvips runtime packages are present, but the current image binary is still
pure-Go until the media-contract blocker is closed). It targets the gap between
Immich (heavy) and Ente (hard to self-host).
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
- **R1 content admission (2026-07-10):** standard image/video signatures now determine media type before the filename extension; renamed valid media imports with its detected MIME, while mismatched advertised media is recorded as an import error. Opaque camera RAW files retain an extension-based admission exception until a fixture-backed decoder policy is available.
- **Import/export safety (2026-07-10):** browser queue staging isolates each uploaded file, so repeated filenames cannot overwrite one another. Portable backup format v2 records an archive manifest; restore validates it in a temporary sibling directory before swapping into an empty target. `kuraki backup` takes an online SQLite snapshot before packaging a live library. ZIP exports preflight originals and bypass the normal API deadline, so they no longer quietly omit unavailable files or time out at 60 seconds.
- **Capture foundation (2026-07-10):** migration `00012` adds revocable devices and resumable upload sessions. Browser-authenticated users create a device token; `POST/PATCH/complete /api/capture/uploads` writes bounded chunks to staging and hands a complete file to the existing queue/importer. `mobile/` is an Expo/React Native iOS+Android client with SecureStore settings, status receipts, and manual photo selection/upload. It also does automatic camera-roll backup (persisted, restart/network-loss safe), OS background scheduling, streamed large-file uploads, QR pairing, and per-album selection — the Capture loop is functionally complete.
- **Module path:** `github.com/kuraki-app/kuraki`. Migrations through `00014`.
- **Not browser-click-tested:** the SvelteKit UI compiles and serves and all endpoints are E2E-verified
  via curl, but no headless-browser pass has been run (per human request).
- **Env-gated / pending:** `-tags vips` build (needs libvips + `pkg-config`), HEIC out of the box,
  low-resource benchmark; plus roadmap items (slideshow, stacks, near-duplicate grouping,
  multi-user, mobile, optional ML).
- **Production-readiness audit (2026-07-12):** `PRODUCTION_READINESS_AUDIT.md`
  reconciles the code, documentation, and peer practices. It makes the current
  Docker/libvips claim, 20k quadratic duplicate limit, untested migration
  rollback path, absent web/mobile automation, mobile release packaging, and
  limited operations telemetry explicit release blockers. `ROADMAP.md` now
  prioritizes evidence before scope expansion.

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
  db/                  Open (WAL + perf pragmas), Migrate (+snapshot); migrations embedded (→ 00014)
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
  ocr/                 opt-in local text recognition (tesseract via exec; feature-detected)
web/                   SvelteKit SPA (routes: timeline/search/favorites/albums/memories/places/duplicates/stats/devices/activity/archive/hidden/trash)
mobile/                Expo / React Native iOS+Android client (Capture backup + Library browse/search/filter tabs)
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
`KURAKI_TRASH_RETENTION_DAYS` (`30`), `KURAKI_THUMBNAIL_SIZE` (`512`),
`KURAKI_OCR` (`off`; `1` enables the local tesseract OCR worker),
`KURAKI_SECURE_COOKIES` (`off`; `1` marks the session cookie Secure for HTTPS).

## 8. Progress ledger (update this)

| Area | Status |
|---|---|
| Server foundation, import, media pipeline, web UI, auth, trash, verify, video | ✅ done |
| Places (map + offline geocoding), Takeout import, favorites/albums/memories, stats | ✅ done |
| Import queue + Activity + per-file errors, metadata editing, config options, serving perf | ✅ done |
| R1 media compatibility: explicit view state, safe preview/transcode fallback, media-health rebuild | ✅ done |
| R1 content-aware admission for standard media signatures | ✅ done (RAW extension exception) |
| R2: tags/hierarchical tags, saved searches, ratings, archive/hidden, external libraries, backup/restore | ✅ done |
| R2: duplicate review (exact + near-duplicate by hamming), stacks (RAW+JPEG / Live-Motion), whole-library export, scheduled integrity verification | ✅ done |
| Import/export safety: duplicate upload basenames preserved; live backup snapshot; restore staged and manifest-validated; ZIP exports preflighted and unbounded | ✅ done |
| Capture foundation: device tokens, resumable server sessions, React Native status/manual-upload client | ✅ initial slice |
| Automatic camera-roll backup: persisted queue, chunk retry/backoff, restart-safe dedup, needs-attention surface | ✅ done (client) |
| OS background scheduling (expo-background-task) + streamed large-file uploads (expo-file-system handle) | ✅ done (client) |
| Capture-session expiry sweep (startup + hourly janitor) | ✅ done |
| R1/R2 exit criteria | ✅ met (Takeout + mounted folder re-import without metadata loss; backup/restore on clean instance; org actions on indexed queries) |
| R1 full fixture matrix across libvips and Chromium/Firefox/WebKit | ⬜ env-gated release certification |
| R2 remaining (nice-to-haves): XMP sidecars, non-destructive edit, burst grouping, slideshow/jump-to-date/grid-density/dark-mode/a11y polish | ⬜ roadmap |
| libvips-default Docker image / HEIC verified, low-resource benchmark | ⬜ env-gated |
| QR device pairing: web mints code + QR, mobile scans to claim its own token | ✅ done |
| Per-album backup selection (choose device albums; default whole library) | ✅ done |
| Find: one filter language (q/date/type/camera/favorite/rating/place/album) on paginated /api/search | ✅ done |
| Find: device-authenticated library read + mobile Library tab (grid, filters, offline cache) | ✅ done |
| Find: web timeline filter bar aligned to mobile | ✅ done |
| Find: opt-in local OCR (tesseract) indexes screenshot/document text into FTS | ✅ done |
| **Maintain**: portable sidecars/manifest, canonical external identity, restore rehearsals, storage forecast | ⬜ release blocker |
| **Harden**: Docker now uses the vips build; duplicate runs, private artifacts, security headers, metrics text, migration regression, and mobile build foundations landed; certification/capacity remain | 🟡 in progress |
| Optional local intelligence (faces/semantic), scale (S3/Postgres/hardware) | ⬜ later phases |
| Sharing & multi-user (links, household albums, roles, OIDC) | ⏸ parked by decision |

Detailed history: [CHANGELOG.md](./CHANGELOG.md). Forward plan: [ROADMAP.md](./ROADMAP.md).

## 9. Next up

Capture and Find are complete; **Sharing is parked by decision**. The active
work is the evidence-backed Maintain/Harden release sequence in `ROADMAP.md`:
truthful Docker media support, scalable duplicate review, portable metadata and
restore proof, security/operability gates, mobile release certification, and
10k/50k/500k capacity evidence. See `PRODUCTION_READINESS_AUDIT.md` for the
audited baseline and release checklist.

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

- `HEAD` — **Daily-use navigation and complete media duplicate review (Codex).** Timeline now supports
  jump-to-date filtering, a persisted Compact/Comfortable/Large grid-density control, and progressive
  thumbnail reveal; failed library loads have an explicit retry and the mobile Backup screen exposes retry
  state for persisted failures. Video posters now receive perceptual hashes, so durable duplicate runs cover
  both images and videos; thumbnail serving already falls back to posters. Migration regression now preserves
  a simulated legacy row through the latest upgrade. `make check`, web build, mobile TypeScript, and Expo lint
  are green. No co-author trailer.

- `HEAD` — **Production foundations batch: media, durable duplicates, security, migration, mobile release (Codex).**
  Docker now builds the `vips` profile and CI compiles/tests it; `MEDIA_SUPPORT.md` records the
  explicit contract. Duplicate review is an all-library, durable SQLite run with progress and persisted
  members; its API returns the latest completed result rather than performing request-time scans. Added
  global same-origin write protection, security headers, authenticated Prometheus text negotiation, and
  private directory/archive/snapshot modes. Added latest migration down/up coverage and a duplicate-run
  persistence test. Mobile now has platform identifiers, EAS internal/production profiles, and a physical
  device release checklist. The remaining recovery, browser-fixture, audit telemetry, and capacity work
  remains deliberately unimplemented for the next batch. No co-author trailer.

- `HEAD` — **Evidence-backed product roadmap and production-readiness audit (Codex).** Added
  `PRODUCTION_READINESS_AUDIT.md`, an implementation-backed Web/Ops/Mobile feature matrix,
  documentation-drift register, peer-product research, release checklist, and explicit exclusions.
  Replaced the daily-use roadmap with Now/Next/Later delivery gates. Key verified blockers are that
  Docker installs libvips but compiles `CGO_ENABLED=0` (so its HEIC/AVIF/RAW claim is false), duplicate
  review covers only the newest 20k images with an O(n²) request path, migrations have Down sections but
  no upgrade/down/up compatibility test, Web/Mobile have no project-owned tests, and Mobile lacks release
  identifiers/profiles. No production code changed. No co-author trailer.

- `HEAD` — **Production hardening batch 1: mobile viewer + reconnect, secure cookies, Docker OCR, CI gates (Claude).**
  New north star = make internal/web/mobile production-ready and correctly linked. (1) **Mobile photo viewer**
  (`photo-viewer.tsx`): tap a Library tile → full-screen swipeable pager, images via best source
  (`fullImageSource`: preview→original→thumb) and video via `expo-video` (only the active page plays). (2)
  **Mobile reconnect flow** (`session.ts`): any device request that gets 401 reports auth-loss, clears the
  SecureStore token, and Library shows a "reconnect in Settings" banner; re-pair/manual-save clears it. (3)
  **Secure cookies**: `KURAKI_SECURE_COOKIES=1` → `config.SecureCookies` → `Deps.SecureCookies` → session
  cookie `Secure` flag (test asserts it). (4) **Dockerfile** adds `tesseract-ocr(+eng)` so opt-in OCR works
  in the container. (5) **CI** gains `web` (npm ci + build) and `mobile` (tsc + expo lint) jobs, so all three
  surfaces are gated. `go test -race`, mobile `tsc`/`expo lint` green. Commit rule now in effect: batch changes,
  don't commit under 8 files unless told. No co-author trailer.

- `HEAD` — **Find phase: unified filters, mobile Library, web filter bar, opt-in OCR (Claude).** Implemented
  roadmap §2 across server, web, and mobile. **One filter language:** `filters.go` (`parseAssetFilters` +
  `respondFiltered`) backs a now-paginated `/api/search` supporting q, from, to, type, camera, favorite,
  rating, place_city, place_country, album, archived, hidden; `searchAssets` is a thin wrapper. **Device read
  surface:** `/api/capture/library` (same filters) + `/api/capture/places` + `/api/capture/assets/{id}/thumb|
  preview|original` reuse the exact web handlers under device-token auth. **Mobile:** a new **Library** tab
  (`src/app/library.tsx` + `library-api.ts`) — search box, All/Photos/Videos/Favorites chips, infinite grid of
  authenticated `expo-image` thumbnails, AsyncStorage offline cache of the recent page. **Web:** the timeline
  gained a filters panel (chips + From/To date) and `api.search` now forwards a cursor. **OCR (opt-in, local):**
  `internal/ocr` shells to tesseract; migration `00014` adds `ocr_text` to assets + FTS; a `KURAKI_OCR=1`-gated
  background worker OCRs each image's thumbnail and refreshes its FTS row so screenshot text is searchable
  (off by default; tesseract not present here, so the worker no-ops). Tests: unified filters + device parity +
  device thumb + unauth rejection; OCR normalize + guarded round-trip; config flag. `go test -race`, web build,
  mobile tsc + expo lint all green. Migrations through `00014`. **Find loop is functionally complete.** No co-author trailer.

- `HEAD` — **Per-album backup selection (Claude).** The last open Capture milestone, client-only. Added
  `albumIds` to the persisted backup state; `backupEngine.listAlbums()` (via `MediaLibrary.getAlbumsAsync`,
  non-empty albums only) and `setAlbums()`; `collectNewAssets` now scans only the selected albums when any
  are chosen (deduping an asset that appears in several) and falls back to the whole library otherwise. New
  `AlbumPicker` modal (albums with toggles + an "All photos & videos" option) opened from a Backup-screen row
  that shows the current scope. `tsc --noEmit` and `expo lint` clean. The Capture roadmap loop
  (Capture → Find → Share → Maintain, section 1) is now functionally complete. No co-author trailer.

- `HEAD` — **QR device pairing across server, web, and mobile (Claude).** A phone can now pair by scanning a
  QR instead of pasting a token. Server: migration `00013` adds single-use `pairing_codes`; `POST /api/devices/pair`
  (auth) mints a 5-minute code, `POST /api/devices/pair/claim` (public, IP rate-limited) atomically claims it in a
  transaction — guarded single-row update → insert device → back-reference `device_id` so the FK holds — and returns
  a fresh device token. The capture janitor also sweeps expired codes. Added `pairing_test.go` (mint → claim →
  token authenticates a device endpoint → reuse rejected 409 → unknown 404). Web: new `/devices` page mints a code
  and renders `{base_url, code}` as a QR via the `qrcode` dep (added), plus a Devices nav item. Mobile: `claimPairing`
  in `capture-api.ts`, a `PairScanner` component (`expo-camera`, added, with permission plugin) opened from Settings,
  which stores the returned token in SecureStore. `go test -race`, `npm run build` (web), `tsc --noEmit` + `expo lint`
  (mobile) all green. Migrations through `00014`. Remaining Capture milestone: per-album selection. No co-author trailer.

- `HEAD` — **Background scheduling + streamed large-file uploads (Claude).** Closed two open Capture
  milestones in the mobile client. `background.ts` defines an `expo-background-task` (imported from the root
  `_layout.tsx` so the task exists when the OS relaunches the app headlessly); the auto-backup switch now also
  registers/unregisters it (`minimumInterval` 15 min, honest "unavailable" copy when the OS restricts it), and
  an on-open effect catches up in the foreground when auto was left on. Each background wake runs the same
  `backupEngine`, so the persisted done-set still prevents duplicates. Refactored `capture-api.ts` to stream:
  a new `MediaSource` reads `file://` inputs one chunk at a time through an `expo-file-system` `FileHandle`
  (`sendChunk` now takes a pre-read `ArrayBuffer` + total, not a whole `Blob`), with a buffered `fetch` fallback
  for non-file URIs — a multi-gigabyte video no longer materialises in memory. Added deps: `expo-file-system`,
  `expo-background-task`, `expo-task-manager` (the last auto-added its config plugin to `app.json`). `tsc --noEmit`
  and `expo lint` are clean. Remaining Capture milestones: QR pairing and per-album selection. No co-author trailer.

- `HEAD` — **Automatic camera-roll backup in the mobile client (Claude).** Built the daily-habit Capture
  loop on top of Codex's resumable API. New `mobile/src/lib`: `backup-store.ts` persists backup state via
  `@react-native-async-storage/async-storage` (a `doneIds` set + failed items + last success); `backup-engine.ts`
  is a singleton that pages the camera roll newest-first with `expo-media-library`, uploads every asset the
  server hasn't accepted, records progress after each item, retries on the next run, and exposes a subscribable
  progress snapshot. Refactored `capture-api.ts` into a shared `uploadFile` with per-chunk retry/backoff that
  realigns to the server's `Upload-Offset` after a drop (manual `uploadPhoto` now wraps it). The Backup screen
  gained an auto-backup switch, a "Back up new photos" / Pause control, Waiting/Backed-up/Needs-attention counts,
  and a per-item failure list. Added the `expo-media-library` permission plugin to `app.json`. Satisfies the
  roadmap Capture exit criteria: a completed item is remembered across restart (no re-upload), a network drop
  resumes from the acknowledged offset, and content-hash dedup guarantees no duplicate asset ever. `tsc --noEmit`
  and `expo lint` are clean. Known limits (noted): large videos buffer per file (streamed reads planned); no OS
  background scheduling yet (foreground/manual run only). No co-author trailer.

- `HEAD` — **Reviewed Codex's Capture branch + expiry sweep (Claude).** Read through the capture API,
  migration `00012`, queue `EnqueueStagedDirectory`, router wiring, and the `mobile/` client; confirmed
  `jobs.kind` is unconstrained TEXT (so `'capture'` jobs are valid), the nested `mobile/.gitignore`
  excludes `node_modules`/`.expo`/`.DS_Store` (only 31 real source files stage), and the full resumable
  flow is tested. Fixed a stray-space gofmt issue in `router.go`. **Closed the roadmap's "expiry cleanup"
  gap:** added `app.startCaptureJanitor` (startup + hourly) which sweeps `status='receiving'` sessions past
  `expires_at`, removing their staging directories and rows so abandoned uploads don't leak. `go build`,
  `go vet`, and `go test -race` (excluding `mobile/node_modules`) all green. No co-author trailer.

- `HEAD` — **Daily-use roadmap + Capture foundation (Codex).** Replaced the feature-parity roadmap with Capture → Find → Share → Maintain user loops; Capture is now the active priority. Migration `00012` adds `devices` (revocable SHA-256 token credential) and `upload_sessions`; the device-authenticated capture API starts a session, accepts bounded `Upload-Offset` chunks, and idempotently queues its finished staging directory through the existing import worker. Capture status reports receiving/queued/failed sessions. Added a tested Expo/React Native iOS+Android client in `mobile/`: SecureStore-backed server/token setup, backup receipts, and a manual Image Picker photo upload through the resumable API. Expo lint and focused Go tests pass. Next: QR pairing, camera-roll album enumeration, persisted client retry queue, and native background scheduling constraints.

- `HEAD` — **R1 content-aware import admission (Codex).** `media.ClassifyFile` reads standard JPEG/PNG/GIF/WebP/BMP/TIFF/JXL/JP2, ISO-BMFF (AVIF/HEIC/MP4/MOV/3GP), EBML (WebM/Matroska), AVI/WMV/MPEG/TS signatures before a file enters the importer. A valid JPEG renamed `.bin` now imports as `image/jpeg`; plain text renamed `.jpg` is surfaced as an import error rather than retained as corrupt media. Camera RAW remains the deliberate extension-based exception until fixture-backed decoding is available. Focused media/importer tests and `make check` are green.

- `HEAD` — **Live backup consistency (Codex).** `kuraki backup` now opens the existing SQLite database and uses `VACUUM INTO` to create a point-in-time temporary snapshot before archiving the data directory. The backup archives that snapshot as `kuraki.db` and excludes mutable `kuraki.db-wal`/`kuraki.db-shm` files, while originals are copied afterwards (write-once import order guarantees every snapshot-referenced original already exists). A backup→post-snapshot mutation→restore test verifies the restored database holds only the snapshot state and no WAL is archived. Focused backup/CLI tests are green.

- `HEAD` — **ZIP export reliability (Codex).** Selected and whole-library ZIP endpoints now check every original before committing download headers, return an explicit conflict when one is unavailable, check database rows and stream-copy/close errors, and log an interrupted stream instead of silently omitting data. `/api/assets/zip` and `/api/export` bypass only the normal 60-second request timeout, preserving it for every other route. Added authenticated HTTP coverage for whole-library ZIP bytes, missing-original rejection, and timeout exemption. `make check` is green.

- `HEAD` — **Import/export safety hardening (Codex).** Browser upload staging now gives every multipart file its own numbered directory, preventing same-basename uploads from overwriting one another before import; a queue regression test uploads two different `IMG_0001.jpg` files and verifies two assets. Backup format v2 writes a file-count/byte-count manifest and restore extracts into a sibling temporary directory, rejects missing/mismatched/unsafe archives, then swaps only a validated archive into an empty target (with rollback for the existing empty directory). Format v1 restore compatibility remains. The later live-backup snapshot work closes the remaining SQLite-consistency gap.

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
