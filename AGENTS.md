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
- **Web design pass (2026-07-17, `feat/web-kura-vault`):** the SvelteKit client has a deliberate
  aesthetic for the first time — hybrid **Kura/Vault registers**, a re-derived palette (oxblood
  `--stamp` for Kuraki's own marks; `--primary` stays ink so buttons never fight the photographs),
  Fraunces display + Geist Mono for Vault data, a **motion system where there was none** (the app
  previously had zero Svelte transitions), a **gapless proof-sheet grid**, a native View-Transitions
  **grid→viewer morph** (zero new deps), and a grouped nav + real mobile tab bar replacing a
  13-unlabelled-glyph scroller. **Six pre-existing WCAG AA failures closed** — `web/scripts/check-contrast.py`
  now gates the palette by parsing `app.css` directly. **Not browser-verified**: no browser was
  available in the authoring environment; the morph, reduced-motion skip, font loading, keyboard
  focus and mobile sheet all need a human pass. See §11 for the traps this work uncovered
  (`@theme inline` never emits custom properties; box-shadow paints under children;
  `view-transition-name` must be uniquely held; Svelte transitions ignore the CSS reduced-motion rule).
- **Mobile parity (2026-07-18, `feat/mobile-parity`):** the Expo client gained **Albums** (view/create/add/remove), **On this day** (memories), and **Trash** (restore + permanent delete) — server-authoritative in the Immich model (all writes via API, local SQLite mirror + offline mutation queue). A narrow `ownerID(r)` bridge lets album handlers serve both session (web) and device (mobile) auth; the flagged unscoped `setFavorite` is now owner-scoped; device trash writes (delete/restore/purge) are owner-guarded via `ownsAsset`; new `trash.Purge` backs permanent delete. Library tab gained Timeline/Albums/On-this-day segments; Trash lives under Settings; album creation is online-only.
- **Mobile foundation (2026-07-18, `feat/mobile-foundation`):** the Expo client gained a production
  foundation — a design system GENERATED from the web palette (`mobile/scripts/sync-tokens.mjs` parses
  `web/src/app.css` into `mobile/src/design/tokens.ts`, CI-gated against drift), Kura/Vault registers +
  Fraunces/Geist-Mono fonts, an onboarding gate keyed on a persisted `setup-complete` flag (mandatory
  server IP/URL entry + QR fast path), a connection state machine (unreachable vs revoked-token,
  dismissible on Library / persistent on Backup), an expo-sqlite offline cache with a favorite-write
  mutation queue, and one owner-scoped device-auth favorite route (`POST /api/capture/assets/{id}/favorite`).
  Vitest covers the pure logic (URL normalizer, connection machine, mutation classifier).
- **Server delta sync (2026-07-19, `feat/delta-sync`, Improvement B):** the delta feed
  (`GET /api/changes` session-mounted, `GET /api/capture/changes` device-mounted — same
  `d.changes` handler via the `ownerID(r)` bridge) now serves a **completed** `change_log`:
  every asset mutation (favorite, edit, tag, album add/remove, import, trash/restore/purge,
  external-library scan, batch favorite/archive/hide, and batch `shift-time`) logs a change.
  `change_log` gained `owner_id` (migration `00020`,
  backfilled from `assets`, indexed `(owner_id, id)`) so a purged asset (no joinable `assets`
  row) still resolves an owner. The feed is thin — id/entity/entity_id/op only, the client
  refetches via existing asset endpoints — and cursor-paginated on `change_log.id`
  (`?since=&limit=`, response echoes the next `cursor` + `has_more`).
- **Mobile Places (2026-07-22, `feat/mobile-places`):** the Library tab gained a
  **Places** segment — a **MapLibre v11** (OpenFreeMap vector tiles, no key, no Google)
  map of GPS-bearing assets with built-in GeoJSON clustering (oxblood count bubbles,
  **no thumbnails on the map** — dodges 5000 authed native markers), a `@gorhom/bottom-sheet`
  place list (authed cover thumbs), tap-point→viewer and tap-place→filtered grid (reuses
  `fetchLibrary({place_city, place_country})` + `PhotoGrid`; added `place_country` to the
  mobile filter). **Server unchanged** — `/api/places` + `/api/places/summary` were already
  device-auth-reachable under `requirePrincipal`, and the filter language already had
  `place_city`/`place_country`. Online-first (no offline map cache); connection/empty states
  via a pure `placesViewState` gate. Pure logic (geojson builder + gate) Vitest-covered; the
  native map is **dev-client-verified only** (like `-tags vips`). Adds native deps
  (`@maplibre/maplibre-react-native`, `@gorhom/bottom-sheet`) + a MapLibre config plugin →
  the dev client must be rebuilt (`eas build --profile development`). First of three sequenced
  parity slices (Places → Tags+saved-searches → Duplicates+stacks). Spec:
  `docs/superpowers/specs/2026-07-22-mobile-places-design.md`.
- **Mobile Tags (2026-07-23, `feat/mobile-tags`):** the Expo client gained tagging —
  a per-asset **tag editor** in the viewer (checkbox sheet, offline-queued via a new
  `set_tags` pending-mutation kind; tag *create* is online-only) and **browse-by-tag**
  (a Library header sheet → a filtered-grid route reusing `PhotoGrid` + `fetchLibrary`).
  Cached tag list (cache schema **v4**) so browse renders offline. **One server change**:
  a `tag=<id>` param added to the shared filter language (`parseAssetFilters`, a JOIN on
  `asset_tags`, mirroring the `album` filter) — no migration, no DTO change; web benefits too.
  Go filter test + Vitest (tag param, `set_tags` classifier) green; native sheets
  dev-client-verified only. Second of three parity slices (Places ✓ → Tags → Duplicates+stacks).
  Spec: `docs/superpowers/specs/2026-07-22-mobile-tags-design.md`.
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
| Docker image runs ONE process — `kuraki serve` on :3000 serves API + media + embedded UI (first-run setup included) from a single origin. The dual-origin Caddy :8080 layer was removed once the embedded UI booted correctly (CSP nonce fix); CLI subcommands still pass through the entrypoint. Production HTTPS still fronts it via `deploy/` (proxies to :3000) | ✅ done |
| Phone pairing hardened: codes hashed at rest (code_hash, migration 00019), web shows no plaintext code, QR is an opaque app-only `kuraki://pair?d=…` blob the mobile scanner decodes | ✅ done |
| Public `GET /download/android` serves an operator-supplied APK (KURAKI_ANDROID_APK, default `<data>/downloads/kuraki-android.apk`), linked from Devices; Caddy :8080 proxies /download/*; APK built out of band | ✅ done |
| Web design pass (`feat/web-kura-vault`): Kura/Vault registers, re-derived palette + type, motion system, gapless proof-sheet grid, native View-Transitions morph, grouped nav + mobile tab bar | 🟡 built, **needs a human browser pass** |
| Web a11y: 6 pre-existing WCAG AA failures closed (`--text-faint` body contrast; `--input` 1.4.11 control boundary, both themes). `web/scripts/check-contrast.py` gates the palette against `app.css` | ✅ done |
| Web registers applied to **shared chrome only** (PageHeader/cards/EmptyState/`.content`) by human decision; per-route Vault treatment (mono data columns, dense tables, Overview stat tiles) | ⬜ deliberate scope cut |
| **Timeline virtualization** — `AssetGrid` now windows by day-group section (IntersectionObserver + measured-height spacers); on-screen tile DOM stays bounded regardless of library size. Browser-verified: 579 assets / 40 days held constant at ~81 tiles / 6 live sections across all scroll positions | ✅ done |
| Optional local intelligence (faces/semantic), scale (S3/Postgres/hardware) | ⬜ later phases |
| Sharing & multi-user (links, household albums, roles, OIDC) | ⏸ parked by decision |
| Mobile foundation: generated design tokens, Kura/Vault registers, onboarding gate, connection state machine, SQLite offline cache + favorite mutation queue, owner-scoped device favorite route | ✅ done (Spec 1) |
| Mobile parity: albums/memories/trash device routes, `ownerID` bridge, owner-scoped `setFavorite` + trash writes, `trash.Purge`, Library segments + selection mode + Trash screen, extended offline mirror/queue (album_add/remove, trash, restore, purge) | ✅ done (Spec 2) |
| Server delta sync (Improvement B): change_log completed (all asset mutations logged) + owner_id (00020) + owner-scoped cursor-paginated /api/changes + /api/capture/changes feed | ✅ done |
| Delta-sync client wiring (B fast-follow): web polls `/api/changes` → `bumpLibrary()` reload; mobile drains `/api/capture/changes` into the SQLite mirror (per-asset refetch/remove) on foreground + mount. New device route `GET /api/capture/assets/{id}` backs the thin-feed refetch. Mobile cache schema v3 (`sync_meta` cursor) | ✅ done |
| Real-time push (Improvement C): SSE `GET /api/events` (session auth) pushes a wakeup when `change_log` advances; web `EventSource` drains the cursor feed on each push (poll relaxes to a 60s safety net). One server-side `ChangeBroker` poller fans out to all subscribers. Browser/curl-verified end-to-end. Mobile stays on foreground-drain (EventSource can't send a Bearer header) | ✅ done |
| Unified auth principal (Improvement D): one `requirePrincipal` middleware accepts session cookie OR Bearer device token → single `/api/*` route tree; `requireSessionPrincipal`/`requireDevicePrincipal` narrow the owner-console + capture-ingest routes; `/api/capture/*` duplicates collapsed (only uploads/status remain); every asset read+mutation owner-scoped with cross-owner isolation tests; mobile calls `/api/*` with its token. Web + mobile now reach the same functionality | ✅ done |
| API contract (Improvement A): swag→OpenAPI pipeline, served `/api/openapi.json`, wire DTOs consolidated into `apitypes`, all endpoints annotated, generated TS for web+mobile, `validate:"required"`/`enums` so generated types keep the server's real guarantees, both clients consuming the contract, drift gated in CI | ✅ done |
| Contract drift gate: `make check-gen` regenerates spec + both client type files and fails on any diff (CI job `contract`). Generators pinned (swag `v1.16.4` via `go run`, swagger2openapi `7.0.8`, openapi-typescript `7.4.4`) — an unpinned generator would fail the gate spuriously | ✅ done |
| Web type gate: `svelte-check` is now a devDependency + `npm run check` + a CI step. **`npm run build` never typechecked** (Vite strips types; plain `tsc` skips `.svelte`), so web had no type gate at all | ✅ done |
| Mobile Places (`feat/mobile-places`): Library **Places** segment — MapLibre v11 (OpenFreeMap vector tiles, no key) clustered map (count bubbles, no thumbnails on map) + `@gorhom/bottom-sheet` place list (authed covers), tap-point→viewer / tap-place→filtered grid (`place_city`+`place_country`). Server unchanged. Pure geojson-builder + view-state gate Vitest-covered; native map **dev-client-verified only**. First of 3 parity slices | 🟡 code-complete (tsc+lint+vitest green), **native map needs a device dev-client pass** |

| Mobile Tags (`feat/mobile-tags`): per-asset tag editor (viewer, offline-queued `set_tags`, online-only create) + browse-by-tag (Library sheet → filtered-grid route). Cached tag list (cache v4). One server change: `tag` filter in `parseAssetFilters`. Go filter test + Vitest green; native sheets dev-client-verified. Second of 3 parity slices | 🟡 code-complete (go test + tsc + lint + vitest green), **native sheets need a device pass** |

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

- `fix/review-findings` (2026-07-23) — **Whole-repo review fixes (root-cause, not patches).**
  - **Duplicate review showed trashed assets** (`internal/httpapi/duplicates.go`): the group query joined `assets` without `deleted_at IS NULL`, and trash never removed `duplicate_group_members`, so a resolved duplicate resurfaced on refetch (and a group could render as one live asset + trashed ghosts). Now filters `deleted_at` and drops groups with <2 live members. Test: `TestDuplicatesExcludesTrashed`.
  - **Web `filtered` missed non-form filters** (`web/src/routes/+page.svelte`): it only tested q/type/favorite/from/to, so applying a saved search carrying place/tag/camera/rating set `applied` but left `filtered=false` → unfiltered timeline. Now `Object.values(applied).some(non-empty)`.
  - **`syncChanges` sentinel** (`mobile`): replaced the `applied+1` reset hack with an explicit `{ applied, reset }`; caller reloads on `applied>0 || reset`. Also swapped the Duplicates `keyExtractor`'s `Math.random()` fallback for a stable group index.
  - Verified: `make check` (incl. new test), mobile `tsc`/`lint`/`vitest` (48), web `svelte-check`/build all green.

- `feat/changelog-pruning` (2026-07-23) — **`change_log` is now bounded, with a safe resync fallback. Closes the "change_log pruning" multi-user follow-up for the single-owner case (all 3 surfaces).**
  - **The hazard this avoids.** Naive pruning silently corrupts sync: a client whose cursor is below the deleted rows gets only `id > since` rows that still exist and misses the pruned ones forever, with no error. So pruning is paired with a reset signal.
  - **Server.** A daily janitor (`App.PruneChangeLog` + `startChangeLogJanitor`, mirroring the trash janitor) keeps the newest `KURAKI_CHANGELOG_KEEP` rows (default **100k**; new `config.ChangeLogKeep`). The changes handler derives the pruned floor from `MIN(id)` (no new migration/state) and returns **`reset=true`** with the head cursor when `since > 0 && since < floor-1`. New `ChangesResponse.Reset` field (contract regenerated; `make check-gen` green). Test: `TestChangesFeedResetBelowPrunedFloor` (stale cursor → reset+head; caught-up → no reset).
  - **Clients.** Web `sync.ts`: on reset, jump cursor to head + `bumpLibrary()` (full reload). Mobile `syncChanges`: on reset, `clearCachedAssets()` (wipe the SQLite mirror — it may hold assets deleted while behind), reset the cursor, and return >0 so the caller reloads and rebuilds the mirror from `fetchLibrary`.
  - **What's still parked (unchanged).** Per-client *acked-cursor* tracking (so pruning could be aggressive without ever forcing a reset) and multi-user owner-scoped floors remain future work — the floor here is global (`MIN(id)`), correct for single-owner. The reset fallback makes acked-cursor tracking optional rather than required.
  - **VERIFICATION.** `make check` (incl. the new reset test) + `make check-gen` green; web `svelte-check`+build clean; mobile `tsc`+`expo lint`+`vitest` (48) green. The mobile reset path (mirror wipe + reload) is logic-verified but **not device-run** here.

- `feat/mobile-duplicates` (2026-07-23) — **Mobile duplicate review with native controls. Third/last parity slice (Places ✓ → Tags ✓ → Duplicates ✓). Mobile-only, no server change.**
  - **Native controls (per request).** The screen uses SF Symbols via `expo-symbols` (`SymbolView`, with text fallbacks for Android) for all iconography and the platform-native `Alert` for the destructive keep/trash confirmations (native `destructive`/`cancel` button styling) — not hand-rolled Pressables. `@expo/ui` (SwiftUI/Compose) is available in the tree for deeper native adoption later; this slice stays on the verifiable SF-Symbols + Alert path since there's no device here.
  - **Behaviour.** `duplicates.tsx` (a top-level manage route, like `trash.tsx`, linked from Settings) reads near-duplicate groups from `GET /api/duplicates` (both-principals reachable). Tapping a copy opens a native Alert: "keep this, trash the N others" or "trash just this one". Trashing reuses the existing soft-delete — online `trashAsset`, else `enqueueTrash` (offline queue). Groups collapse in place as they resolve (`removeIds` drops groups left with <2 members). **Triggering a scan stays session-only** (owner console); an empty result shows a "run a scan from the desktop app" state, not a capability gap.
  - **Files.** `lib/library-api.ts` (`DupAsset` hand-typed — the endpoint returns an untyped map, no contract type — + `fetchDuplicates`), `lib/duplicates.ts` (+`.test.ts`: pure `idsToTrash`/`removeIds`/`formatSize`), `app/duplicates.tsx`, `app/(app)/explore.tsx` (Settings link).
  - **DEFERRED: stack badges.** Showing a `⧉ N` badge on grid tiles needs `stack_size` threaded through the narrow `LibraryAsset` Pick + the SQLite mirror — more invasive for the lowest-value half of the slice. Duplicate review (the substantive part) shipped; stacks noted for a follow-up.
  - **VERIFICATION.** mobile `tsc --noEmit`, `expo lint`, `vitest` (37, incl. 5 new pure duplicates tests) all green. Native screen (SF Symbols render, Alert flow, thumbnail auth) is **dev-client-verified only** — no simulator here; no new native module, so no rebuild needed.
- `feat/mobile-places` (2026-07-22) — **Mobile Places map: a Library segment with a clustered MapLibre map + place list. Mobile-only — no server change. First of three sequenced parity slices (Places → Tags+saved-searches → Duplicates+stacks).**
  - **Why no server work (verified before building).** `/api/places` (≤5000 GPS assets, full DTO) and `/api/places/summary` (city/country/count/cover groups) were already under `requirePrincipal` post-Improvement-D, so the device Bearer token already reaches them. The filter language already had `place_city`/`place_country` (`filters.go`) and mobile's `fetchLibrary` already forwarded `place_city` — so "tap a place → that place's grid" needed no route. Multi-user owner-scoping of the places queries stays parked (harmless single-owner), consistent with §8/the D handoff's deferred list.
  - **Map stack decisions.** MapLibre v11 (`@maplibre/maplibre-react-native`) over Google/Apple — open-source, no API key, matches the self-hosted ethos + Immich precedent. OpenFreeMap vector tiles (free, keyless, self-hostable later; light=`liberty`, dark≈`positron`). `@gorhom/bottom-sheet` (reanimated 4 + gesture-handler already present; added `GestureHandlerRootView` at the root layout, which was missing). **The map draws count bubbles only — no thumbnails on native markers** (5000 authed images would be a perf + Bearer-header nightmare); thumbnails live in the sheet via the existing `thumbSource` pattern.
  - **v11 API differs from v10** (the widely-documented one): `Map` (`mapStyle` required, not `MapView`/`styleURL`), `GeoJSONSource` (`data`/`clusterMaxZoom`, ref `getClusterExpansionZoom(clusterId: number)` — takes the numeric `cluster_id`, not the feature), a single `Layer` with `type`+`paint`/`layout` (kebab style-spec keys, not `CircleLayer`+camelCase `style`), Camera `center`/`zoom`/`duration` via `setStop`. **`tsc` typechecks all of this against the installed `.d.ts`, so the native component compiles-verified even without a device.**
  - **Files.** New: `src/lib/places.ts` (pure `buildPlacesGeoJSON` + `placesViewState` gate, Vitest), `src/lib/library-api.places.test.ts`, `src/design/map-style.ts`, `src/components/places-map.tsx`, `place-list.tsx`, `places-screen.tsx`, `src/app/(app)/place.tsx` (filtered-grid route). Modified: `library-api.ts` (+`fetchPlaces`/`fetchPlacesSummary`/`PlaceGroup`, +`place_country` filter), `library.tsx` (+`places` segment), `_layout.tsx` (+GestureHandlerRootView), `app.json`/`package.json` (deps + plugin).
  - **VERIFICATION GAP — the native map is NOT verified here.** This machine has no iOS/Android simulator, and MapLibre is native. Verified: `tsc --noEmit`, `expo lint`, `vitest` (40 pass incl. 8 new) all green. **Pending a human dev-client pass** (rebuild required — `eas build --profile development`): map renders OpenFreeMap tiles, cluster bubbles + expansion tap, point→viewer, sheet cover thumbs, place→filtered grid, airplane-mode→"needs a connection", dark-mode style swap. The effects defer the first load a tick (`setTimeout(…,0)`) to satisfy `react-hooks/set-state-in-effect`, matching the Library tab pattern.
  - Built inline (spec: `docs/superpowers/specs/2026-07-22-mobile-places-design.md`, plan: `docs/superpowers/plans/2026-07-22-mobile-places.md`; both gitignored under `docs/`). Commits are per-task on this branch.
- `feat/mobile-tags` (2026-07-23) — **Mobile tagging: per-asset editor + browse-by-tag. One small server filter addition; the rest is mobile-only. Second of three parity slices (Places ✓ → Tags → Duplicates+stacks).**
  - **Server (the only Go change).** `parseAssetFilters` (`internal/httpapi/filters.go`) gained an optional `tag=<id>` param — a `JOIN asset_tags atf ON atf.asset_id = a.id AND atf.tag_id = ?`, mirroring the existing `album` filter. No migration (tables exist), no DTO/annotation change (so `make check-gen` stays clean — the search endpoint already leaves `album`/`place_country`/`camera`/`rating` unannotated, and `tag` follows that precedent). Owner-safety rides on `respondFiltered`'s existing owner scoping. Tested by extending `TestUnifiedFiltersAndDeviceSearch` (`?tag=<id>` → the tagged asset; `?tag=missing` → none).
  - **Mobile.** `library-api.ts`: `fetchTags` (cached), `fetchAssetTags`, `setAssetTags` (full-set PUT), `createTag` (online-only), a `tag?` filter, and an `authedPost` helper. New `set_tags` pending-mutation kind (`cache/mutations.ts` + `routeForMutation` → `PUT /api/assets/{id}/tags` with `{ ids }`). Cache schema **v4** adds a `tags` table (`cache/tags.ts`) so browse renders offline. UI: `tag-editor.tsx` (viewer bottom sheet — checkbox list seeded from the asset's tags, inline create, Done → PUT online / `enqueueSetTags` offline), `tag-list.tsx` (browse sheet), `(app)/tag.tsx` (filtered grid — the `place.tsx` pattern). Wired: a `⊕ Tags` button in `photo-viewer.tsx`; a `Tags ▾` chip in the Library timeline header.
  - **Why tag-create is online-only.** A queued create has no server id yet, so a later offline `set_tags` couldn't reference it — same reasoning as album-create. Assigning *existing* tags queues fine.
  - **VERIFICATION.** `go test ./internal/httpapi` (incl. the new filter case), mobile `tsc --noEmit`, `expo lint`, `vitest` (35, incl. the `set_tags` classifier + `tag`-param forwarding) — all green. **The native sheets (`@gorhom/bottom-sheet`) are NOT device-verified** (no simulator here); no new native module, so no dev-client rebuild is needed — but the editor/browse flows need a human pass: tag toggle+Done persists, offline queue drains on reconnect, offline create shows the connect message, tap-tag → grid.
  - Built inline (spec: `docs/superpowers/specs/2026-07-22-mobile-tags-design.md`, plan: `docs/superpowers/plans/2026-07-22-mobile-tags.md`; both gitignored). Commits are per-task on this branch.

- `fix/embedded-ui-csp-nonce` (2026-07-21) — **The embedded SvelteKit UI now boots when the Go binary serves it; Docker simplified to one process.**
  - **Root cause of the blank embedded UI (a real bug, browser-confirmed).** `securityHeaders` set `script-src 'self'` with no `'unsafe-inline'` and no nonce. SvelteKit boots via *inline* `<script>` blocks (the `__sveltekit` bootstrap + the theme script); CSP blocked both, so `kit.start()` never ran — `kuraki serve` on :3000 rendered an empty shell (no nav, no login, **no first-run setup**). Vite dev and the old in-container Caddy didn't set that header, which is why only the embedded path broke and it went unnoticed. This is almost certainly *why* the dual-origin Caddy was added — to serve the SPA from an origin without the strict CSP.
  - **Fix (`internal/httpapi/security.go` + `router.go`).** `contentSecurityPolicy(nonce)` builds the policy; the SPA document (`serveSPADocument`) now injects a fresh per-request nonce into its inline `<script>` tags and emits `script-src 'self' 'nonce-…'`, `Cache-Control: no-store`. Every other response keeps the strict `script-src 'self'` (no `'unsafe-inline'` anywhere). Tests: `TestSPADocumentNonceCSP`, `TestNonDocumentKeepsStrictCSP`. **Browser-verified end-to-end:** `kuraki serve` (one port) → "Welcome to Kuraki" setup screen → created the owner account → landed in the app. First-setup-via-web-UI works.
  - **Docker collapsed to a single process.** With the embedded UI working, the in-container Caddy on :8080 was pure redundancy, so it's gone: `docker-entrypoint.sh` now just `exec kuraki serve` (PID 1, clean SIGTERM); Dockerfile drops the `caddy:2` binary, `/srv/web`, the `ui.Caddyfile` copy, and the XDG scratch env; `EXPOSE 3000` only; `deploy/ui.Caddyfile` deleted; `docker-compose.yml` one port; README/web/README/CLAUDE.md updated. **The production HTTPS reverse proxy (`deploy/Caddyfile`, `docker-compose.caddy.yml`) is untouched — it already proxied to `kuraki:3000`, never :8080.**
  - **Verification gap to note:** Docker isn't available on this machine, so the *image build* is CI-gated only (the Docker CI job). The single-binary runtime it packages is browser-verified. `make check` green; Go build clean.

- `feat/unified-auth-principal` (2026-07-21) — **Improvement D: session and device tokens are now interchangeable principals; one `/api/*` tree; all asset access owner-scoped. Stacked on `feat/sse-push`; merge after the A→B→C stack.**
  - **The principal model.** `requirePrincipal` (auth.go) resolves EITHER a session cookie (`currentUser`) OR a Bearer device token (`resolveDevice`, extracted from the old `requireDeviceAuth`) into a `principal{OwnerID, Kind, DeviceID}` in request context. A device principal ALSO sets the legacy `captureDeviceKey{}` in context so the capture-ingest handlers that call `deviceFromRequest(r)` directly keep working. `d.ownerID(r)` reads the principal. The old `requireAuth`/`requireDeviceAuth` middlewares are deleted.
  - **One route tree, three buckets (router.go).** All authed routes live under `requirePrincipal`. Nested guards narrow two subsets: `requireSessionPrincipal` (owner console — `account/password`, device management, `events` SSE, `duplicates/run`, `export`, `integrity*`, `backup`, `external-libraries*`; 403 `session_required` for a device token) and `requireDevicePrincipal` (capture ingest — `capture/status`, `capture/uploads*`; 403 `device_required` for a cookie). Everything else is reachable by both. The `/api/capture/*` duplicates for shared functionality are gone — **mobile now calls `/api/*` with its Bearer token** (library→`/api/search`, plus assets/albums/trash/memories/changes; `capture-api.ts` keeps `/api/capture/uploads*`+`status`).
  - **Owner-scoping is the security core — every asset read and mutation now filters `owner_id`.** Fixed: `patchAsset`, `shiftTime`, `replaceAssetTags`, `listAssets`, `lookupAsset` (so `getAsset`/`serveOriginal`/`serveThumb`/`servePreview` inherit it), `listTrash`, `onThisDay`, batch favorite/archive/hide **and batch delete/restore** (the batch path skipped the `ownsAsset` guard the single-asset handlers had — a real hole), `listFavorites`, `respondFiltered` (backs `/api/search`; was already device-reachable via the old `/api/capture/library`), and `downloadZip`. Each mutation returns 404 on a non-owned id; cross-owner isolation tests in `owner_scope_test.go` prove owner A cannot read/mutate owner B's asset (all verified fail-before/pass-after). Mutations log the caller's owner, now guaranteed == the asset's owner.
  - **DEFERRED owner-scoping — harmless in single-owner, MUST be closed before multi-user unparks (§8 "Sharing & multi-user"):** aggregate/admin reads still query all owners — `stats.go` (COUNT aggregates), `places.go` (place aggregation), `stacks.go` (`GET /assets/{id}/stack` per-id stack view), `media_health.go` (rebuild existence check), `download.go` `exportLibrary` (session-only whole-library export), the `stack_size` count subquery in `assetSelectSQL`, and `patchAsset`'s internal pre-read at edit.go:46 (the UPDATE is scoped, so no response leak). None are exploitable with one owner; all leak cross-owner data or counts the moment a second owner exists. Grep `FROM assets`/`UPDATE assets` in `internal/httpapi` and scope each when multi-user lands.
  - **Also still owed at multi-user (from earlier handoffs, unchanged):** `change_log` pruning + per-client acked-cursor tracking; the SSE `ChangeBroker` broadcasts a global high-water mark (scope by `owner_id` then); actual multi-user account creation (parked by decision). The delta-sync feed's `OR owner_id IS NULL` clause self-resolves at that point.
  - **Minor left for cleanup:** `trash.go` `purgeAsset` doc comment + swag `@Tags capture` are stale (it moved from device-only to the both-principals bucket) — cosmetic, affects only OpenAPI tag grouping.
  - Built via subagent-driven development (plan: `docs/superpowers/plans/2026-07-21-unified-auth-principal.md`). Verified: `make check`, `make check-gen`, web `npm run check`, mobile `tsc`+`expo lint`+vitest all green.

- `feat/sse-push` (2026-07-21) — **Improvement C: real-time push via SSE. Stacked on `feat/delta-sync-clients`; merge PRs #3 → #4 → this. (Timeline #6 is an independent sibling on the #4 base.)**
  - **SSE is a wakeup, not a data channel — reuses the delta feed wholesale.** `GET /api/events` (session auth) pushes `event: change\ndata: <max id>` when `change_log` advances; the browser's `EventSource` handler drains the owner-scoped `/api/changes` cursor feed on each push. So SSE replaces the client's *poll timer*, not the feed — ordering, owner-scoping, and catch-up all stay in the one place (the cursor feed) already built in #4, and the stream stays trivial. The fallback poll relaxes to 60s while SSE is connected (`open`) and tightens to 15s on `error` (auto-reconnect gap), so freshness never depends on the stream.
  - **One shared poller, zero writer coupling — this is the key design choice.** A single `ChangeBroker` goroutine (`internal/httpapi/events.go`, started in `app.Serve`, 1s cadence) watches `SELECT MAX(id) FROM change_log` and fans advances out to all SSE subscribers. This deliberately avoids plumbing a broker into the non-HTTP writers (`importer`/`trash`/`external`, which write `change_log` directly): they need no change at all. Cost is one indexed MAX query per second regardless of client count. `broadcast` is non-blocking with a cap-1 buffer per subscriber — a full buffer drops the redundant ping because the client drains everything past its cursor anyway (coalescing). Broker seeds `lastID` from the current max on start so a fresh process doesn't replay the backlog as "new".
  - **Session-auth only, by a real constraint — don't "fix" this by adding a device mount.** Browser `EventSource` cannot set an `Authorization` header, and a device token in the query string would leak into logs/history (violates the repo's no-sensitive-data-in-URLs rule). So the device surface keeps its foreground-drain from #4. A future native mobile client that can stream with a Bearer header could reuse the same broker via a device-auth mount; browser EventSource cannot. This mirrors the original session-vs-device auth-shape reasoning.
  - **Multi-user follow-up:** the broker broadcasts a *global* high-water mark to every subscriber. Phase-1 single-owner: exactly right. Multi-user: an uninvolved owner gets a spurious wakeup whose drain returns empty — harmless but chatty. Scope the broadcast by `owner_id` (poll `owner_id, MAX(id) GROUP BY owner_id`, subscribers registered per owner) when multi-user unparks. Tied to the same `change_log`-pruning + per-client-cursor work already flagged in #4.
  - **Verified end-to-end, not just unit.** Broker unit tests (`events_test.go`, race-clean): advance-detection, no-ping-on-connect, non-blocking coalescing. Live: `curl -N /api/events` + a favorite toggle → `event: change\ndata: 1` arrived within ~1.5s; unauthenticated `/api/events` → 401. The blocking SSE HTTP handler itself isn't unit-tested (httptest can't easily drive a never-returning stream) — the broker logic under it is, and the wire behavior was curl-verified.
  - Verified: `make check`, `make check-gen`, `npm run check` (web), mobile `tsc` + vitest all green.
- `feat/timeline-virtualization` (2026-07-21) — **Closed the timeline-virtualization release blocker. Stacked on `feat/delta-sync-clients` (uses its `npm run check` gate); merge PRs #3 → #4 → this in order.**
  - **Windowing is by day-group section, not per-tile — deliberate.** The grid is a responsive `auto-fill` grid whose column count depends on width, so there is no fixed row height to virtualize a flat list against. `AssetGrid` already groups into `<section>` per day; each section now materializes its tiles only while near the viewport (one `IntersectionObserver`, `rootMargin: 1200px 0px`) and renders as a fixed-height spacer otherwise. This sidesteps all column math and leaves the gapless CSS grid, day grouping, and the View-Transitions morph untouched. Trade-off: a single pathological day with thousands of photos still materializes whole (its section is one unit) — fine for real libraries, noted as the one non-virtualized case.
  - **Spacer heights are measured, not guessed.** A materialized section's height is captured via `ResizeObserver` (`measure` action) and cached by day key; the spacer reserves that exact height so scroll position and the scrollbar stay stable as sections mount/unmount. Before first measurement an estimate is used (`estimateHeight`: derives column count from container width + density min-width, tiles are square). Cache is cleared on density change (tile size changes → old heights wrong). Because tiles are `aspect-ratio: 1`, a section's height is layout-determined before images load, so the first measurement is already correct.
  - **Morph safety:** the section holding `morphId` is force-materialized (`morphDay`) so a morph never targets a spacer; in practice the target is on-screen and thus already live. `LibraryView` is unchanged — its `data-asset-id` querySelector for morph-back and its window-scroll infinite-load both work as-is (spacers preserve total scrollHeight, so the `remaining < 900` loadMore trigger is unaffected).
  - **Browser-verified, not just reasoned.** Seeded 579 synthetic assets across 40 days (direct DB insert, no thumbnails needed — placeholder tiles still exercise layout), drove it in Chrome via Vite dev (`npm run dev` proxying to a real server): DOM held **constant at ~81 tiles / 6 live sections at 0/25/50/75/100% scroll** (vs 579 tiles pre-change), infinite-load filled 100→579, density switch re-columned 10→14 and re-measured spacers, zero console errors. **Note:** the Go-embedded binary (`kuraki serve`) would not boot the SPA in this ad-hoc setup (blank shell, affects the login screen too — an embed/env artifact, unrelated to this change); the Vite dev path is what verified it. Morph itself wasn't exercised (seeded assets have no thumbnails, so `canMorph` is false) — its wiring is preserved by `morphDay` but deserves a human pass with a real thumbnailed library.
  - **One-file change** (`web/src/lib/components/AssetGrid.svelte`); `npm run check` + `npm run build` green.

- `feat/delta-sync-clients` (2026-07-21) — **Improvement B fast-follow: web + mobile now consume the `/api/changes` delta feed. Branched off `feat/api-contract` (needs its generated `api.gen.ts`), so land that PR (#3) first.**
  - **New device route `GET /api/capture/assets/{id}` (`d.getAsset`, dual-mounted).** The feed is thin by design (id/entity/op, no payload), so a client seeing a change must refetch the asset — but device auth had *no* single-asset metadata GET (only thumb/preview/original), so mobile literally couldn't. Added it. Mounted **unscoped**, matching the existing capture reads (`onThisDay`, `listTrash`) rather than the `ownsAsset`-guarded capture *writes* — a read follows the read precedent. Test: `TestDeviceGetAsset` (200 / 404 / 401).
  - **Web (`web/src/lib/sync.ts`) is bump-and-reload, not surgical.** Polls `/api/changes` every 15s while signed in, persists the cursor in `localStorage`, and calls the existing `bumpLibrary()` when any change arrives so open library views reload through the app's own invalidation path. Deliberately *not* patching individual assets into the in-memory timeline: the timeline is day-grouped and (soon) virtualized, so an out-of-order create/delete means re-deriving groups anyway — the reload is already correct and cheap. Started/stopped by a reactive block in `+layout.svelte` keyed on `$session.user` (starts on login, stops on logout). Skips polling while the tab is hidden; fires once on regaining visibility. Drains multiple pages per tick (bounded to 20) so a big backlog catches up in one wake.
  - **Mobile (`syncChanges` in `library-api.ts`) IS surgical, because it has the SQLite mirror.** Drains `/api/capture/changes`, and per entry: `op=delete` → `deleteCachedAsset` (drop from the active timeline mirror — can't tell trash from purge and `getAsset` won't return a deleted asset, so the Trash screen's live `/api/capture/trash` refetch owns that state); `create`/`update` → refetch `/api/capture/assets/{id}`, upsert on 200, delete on 404 (deleted between feed page and refetch). Cursor advances **after** a page's changes apply, so a crash mid-page re-applies rather than skips (upserts are idempotent, so re-apply is safe). Wired into `library.tsx` on mount and on `AppState` foreground, guarded by a `syncing` ref against concurrent runs; repaints from the mirror only when ≥1 change applied.
  - **Mobile cache schema v3.** Added `sync_meta(key,value)` kv table for the cursor via the same all-or-nothing `BEGIN…PRAGMA user_version=3…COMMIT` migration discipline as v2 (see `cache/db.ts`). Cursor lives in the cache DB on purpose: the cache is disposable, and if it's dropped the cursor resets to 0 → feed replays from the start → rebuilds the (now-empty) mirror via idempotent upserts. No separate persistence to keep in sync.
  - **Test seam follows the `routeForMutation` precedent.** `syncChanges` touches the cache (loads `expo-sqlite`, which the vitest node env only stubs as a no-op), so the *pure* decision — entity filter + delete-vs-refetch — is extracted as exported `changeAction(entry)` and unit-tested in `sync.test.ts`. The cache-touching apply/drain path is covered by the mobile device pass in `RELEASE_CHECKLIST.md`, not vitest. Don't try to exercise `syncChanges` end-to-end in vitest without first making `test/mocks/expo-sqlite.ts` a real in-memory impl.
  - **Contract regenerated** (the new `@Router` line adds the endpoint to the spec + both `api.gen.ts`); `make check-gen` passes. **Flag for next agent:** `change_log` still has no pruning (unbounded growth) and now has *real* consumers persisting cursors, so the prerequisite the B handoff named — per-client acked-cursor tracking before any time-based prune — is closer to mandatory. Web's cursor is per-browser-origin `localStorage`; mobile's is per-device in `sync_meta`. A prune job must not drop a row any live client's cursor hasn't passed.
  - Verified: `make check`, `make check-gen`, `npm run check` (web), `npx tsc --noEmit` + `expo lint` + `npm run test` (mobile) all green. Not device-verified (vitest + typecheck only, per repo norm for mobile).

- `feat/api-contract` (2026-07-20) — **Web/mobile client types now derive from the generated contract; swag annotations restore the precision the generator was dropping.**
  - **`web/src/lib/types.ts` is now a re-export shim, not a hand-written mirror.** `Asset`, `AssetList`, `User`, `SetupStatus`, `Album`, `Tag`, `SavedSearch`, `PlaceGroup`, `Job`, `MediaIssue`, `LibraryStats` all alias `components['schemas']['apitypes.*']` from `api.gen.ts`. Four types stay hand-written and are commented as such in the file: `DupAsset`, `IntegrityRun`, `BackupRun`, `BackupStatus` — those endpoints return domain-package structs kept out of swag's scope, so there is no schema to alias.
  - **Read this before adding a field to `apitypes`: swag defaults every field to optional.** Out of the box the generator emitted `id?: string`, `media_type?: string` — i.e. the whole client lost non-null guarantees *and* the `'image' | 'video'` / job-status unions the hand-written types had. The Go structs already encode presence correctly (non-pointer + no `omitempty` = always sent), but swag doesn't translate that on its own. Two tags fix it and are now applied across the response DTOs: **`validate:"required"`** → the field is required in the schema, and **`enums:"a,b"`** → a TS union instead of bare `string`. Add both when you add a field, or the clients silently get a weaker type than the server actually guarantees.
  - **Required was applied to response DTOs only, deliberately.** Request bodies (`Credentials`, `AlbumRequest`, `AssetPatch`, `BatchRequest`, …) keep swag's optional default, because `required` on a request field is a claim about what the *client* must send — a different assertion from "the server always populates this." Don't blanket-apply the annotation to the whole file.
  - **Fixed a contract lie: `Tag`, `SavedSearch`, and `ExternalLibrary` had fields with no JSON tag** (`ID, Name string` declared on one line). Go's `encoding/json` serializes those as `"ID"`/`"Name"`/`"RootPath"`/`"CreatedAt"`, but swag lowercases untagged names into `id`/`name`/`rootPath`/`createdAt` — so the published contract described a wire format the server never emitted. Verified by marshalling the structs directly, not by reading the generator output. Now explicitly snake_case-tagged. This was pre-existing (predates the `apitypes` consolidation in 47afbb1), not a refactor regression, and it was harmless only because **no client consumes tags/saved-searches/external-libraries yet** — `web/src/lib/api.ts` declares the methods but no UI calls them. Adding that UI against the old contract would have failed at runtime with no type error.
  - **`/api/jobs` vs `/api/jobs/{id}` are genuinely different shapes.** The list returns `Job`; the detail returns `JobDetail` (embedded `Job` + `errors_detail`). The old hand-written type collapsed both into one `Job` with an optional `errors_detail`, and `api.ts` typed `job(id)` as `Job` — so the activity page's `d.errors_detail` was reading a field its own type didn't declare. `api.ts` now returns `JobDetail`, and `types.ts` exports `JobDetail`/`JobError`.
  - **Verification note — `npm run build` does NOT typecheck.** Vite/esbuild strips TS types without checking them, and plain `tsc` skips `.svelte` files entirely, so both pass over type errors in components. The real gate is `svelte-check`, which is what caught the `errors_detail` mismatch. It is **not** currently in CI (the web job is build-only) and **not** in `web/package.json`; run it ad hoc via `npx -p svelte-check -p typescript@5.8.3 -p svelte@5 svelte-check --tsconfig ./.svelte-kit/tsconfig.json`. Supplying `typescript` and `svelte` to that npx invocation is required — without them it crashes on startup, and the duplicated `svelte`/`esrap` copies it pulls in produce ~837 errors under `node_modules` that are environment noise, not real. Filter to paths under `web/src/`; that count is 0. Landing svelte-check as a real devDependency + CI job is the obvious follow-up and is not done here.
  - **Mobile now derives `LibraryAsset` from the contract via `Pick`, not a full adoption — this was deliberate.** `/api/capture/library` returns the whole `apitypes.Asset` (~30 fields), but mobile reads ~11 and the offline SQLite mirror only persists those columns. Aliasing `LibraryAsset = Asset` outright would have forced two callers to fabricate fields they have no value for: `rowToAsset` (`cache/assets.ts`) can only produce what the mirror stores, and `coverAsset` (`album-list.tsx`) is an intentional stub that exists solely so album cover art reuses the authenticated-thumb path. `Pick<ContractAsset, …>` gets the drift protection — a server-side rename or retype breaks the mobile build — while keeping the narrow shape. If you widen the mirror's schema, widen the `Pick`.
  - **The `Pick` immediately caught two live drifts,** which is the point: `coverAsset` was missing `web_viewable` (the hand-written type had it optional, so an incomplete stub compiled), and `rowToAsset` typed `media_type` as bare `string` against the contract's `'image' | 'video'`.
  - **`rowToAsset`'s nullable casts were lying.** It read `(r.thumbnail_url as string) ?? null` — casting a genuinely NULL-able SQLite column to non-nullable `string` makes the `??` dead code, so a real NULL would flow through under a non-null type. Now cast `as string | null` before the `??`, collapsing to `undefined` (not `null`) because the server omits absent pointers rather than sending null. `cache/albums.ts` has the same `as string` pattern for `cover_asset_id`, left alone deliberately: `CachedAlbum` declares that field `string | null`, so a runtime null is correctly typed there and there is no defect to fix.
  - Verified: `make check`, `make check-gen` (passes clean, and fails as intended on an injected drift), `npm run check` (web, 0 errors / 4618 files), `npm run build` (web), `npx tsc --noEmit` + `expo lint` + `npm run test` (mobile) all green.

- `feat/delta-sync` (2026-07-19) — **Server delta sync (Improvement B): completed `change_log`, `owner_id`, owner-scoped `/api/changes` feed.**
  - **Feed contract.** `d.changes` (new `internal/httpapi/changes.go`) is mounted at both `GET /api/changes` (session auth, inside the existing `requireAuth` group) and `GET /api/capture/changes` (device auth, inside `requireDeviceAuth`) — one handler, owner resolved either way through the `ownerID(r)` bridge introduced in mobile parity. Thin by design: each entry is `{id, entity, entity_id, op}` only; the client refetches the changed asset via the existing asset endpoints rather than the feed carrying a payload. Cursor-paginated on `change_log.id` — the client sends `?since=<last cursor>&limit=`, the response echoes `cursor` (the last id returned, or `since` unchanged if the page was empty) and `has_more` (detected via a `limit+1` fetch, no second query). `limit` defaults to 500, clamps to 1000; `since` defaults/clamps to 0 on a bad/negative value rather than erroring.
  - **`change_log` is now actually complete.** Every asset-mutating handler logs a change via `logAssetChange(ctx, assetID, owner, op)` (best-effort — a logging failure is `slog.Warn`'d, never fails the user's mutation): favorites (session + device), metadata edits, tag replace, album add/remove, plus the non-HTTP paths — `importer` on import, `trash` on delete/restore/purge, `external` on library scan. Previously only a subset of writes logged; a feed built on that would have silently missed edits/tags/trash/import activity.
  - **Phase-1 `owner_id IS NULL` clause — read before touching the feed query.** The query is `WHERE id > ? AND (owner_id = ? OR owner_id IS NULL) ORDER BY id ASC LIMIT ?`. The `OR owner_id IS NULL` exists because a purged asset's `assets` row is gone by the time some historical rows were written/backfilled, so a null owner is treated as visible to the sole Phase-1 owner rather than silently dropped. **This makes the query plan a MULTI-INDEX-OR against a temp b-tree** (SQLite can't satisfy an OR-of-columns with the single `(owner_id, id)` index the way it could satisfy `owner_id = ?` alone) — checked with `EXPLAIN QUERY PLAN`, acceptable at current `change_log` volumes but worth re-profiling once the table is large. It **self-resolves**: once multi-user unparks (§8 "Sharing & multi-user", currently parked by decision) and every row is confirmed owner-backfilled, drop the `OR owner_id IS NULL` clause and the planner falls straight into a clean `(owner_id, id)` range scan on the existing index. Don't try to "optimize" this before then — the NULL branch is load-bearing for the purged-asset case, not dead code.
  - **`change_log` pruning is explicitly deferred, not forgotten.** The table grows unbounded — nothing purges old rows. Not addressed here because pruning safely needs client-cursor tracking first (a row can only be dropped once every client's persisted cursor has moved past it, else a laggy client's next `?since=` re-request silently skips changes instead of erroring). Flagged for whoever picks this up: don't add a naive time-based prune job without first landing a per-device/per-session "last acked cursor" record.
  - **Review Minor closed:** `TestChangesFeedCursorAndScope` only ever exercised the device/bearer mount (`/api/capture/changes`); added `TestChangesFeedSessionAuth` in `internal/httpapi/changes_test.go` hitting the session/cookie mount (`/api/changes`) directly, proving the session route also returns owner-scoped data through the same handler.
  - **Final-review IMPORTANT closed:** `batchAssets` (`internal/httpapi/batch.go`) favorite/unfavorite/archive/unarchive/hide/unhide previously mutated with no `change_log` entry at all — archive/hide have no single-asset handler, so batch was (and remains) their only mutation path, meaning it was completely unlogged, not just double-counted. `shiftTime` (`internal/httpapi/edit.go`) likewise updated `taken_at` on up to 1000 assets with no logging. Both now call `logAssetChange`; `batchAssets` does NOT log `delete`/`restore` itself since those already route through `trash.Delete`/`trash.Restore`, which log — logging again there would double-log. `shiftTime` logs after `tx.Commit()` succeeds (not inside the per-id loop) because `logAssetChange` writes via `d.DB` outside that transaction; logging mid-loop would leave orphaned `change_log` rows for updates a later-iteration failure rolled back.
  - **Flag: unscoped-by-id mutations, correct-attribution-only-by-luck.** `patchAsset` (edit.go) and `replaceAssetTags` (organization.go) mutate an asset by `id` with no owner filter in the `WHERE` clause, and log the *caller's* `owner`, not the asset's actual owner. Phase-1 harmless (one owner exists), but this is NOT the same bug class as the `owner_id IS NULL` clause in §11's feed-query note above — that one self-resolves when multi-user lands and rows are backfilled; this one does NOT self-resolve, because nothing stops caller A from editing/tagging an asset owned by caller B and having the change attributed to A. The batch favorite/archive/hide UPDATEs added in this fix have the same gap (`updateFavorite`/`updateLibraryState` filter on `id` only). All of these need owner-scoped mutation (`WHERE id = ? AND owner_id = ?`) plus correct-owner log attribution as explicit multi-user work, tracked alongside the existing single-owner `setFavorite`/`onThisDay`/`listTrash` TODOs.
  - **Flag: auto-stacking doesn't log.** The background auto-stack job (`internal/stacks/stacks.go`) updates `stack_id`/`stack_primary` on assets with two raw `UPDATE assets SET stack_id = ...` statements and no `change_log` entry. Minor — a client mirroring stack membership via the delta feed won't see stack changes reflected — deferred rather than fixed here since it's a background job, not a request handler, and needs its own owner-resolution plumbing.

- `feat/mobile-parity` (2026-07-18) — **Mobile parity: Albums/memories/trash via device routes, `ownerID` bridge, Library segments + Trash screen.**
  - **Ten device-auth routes added.** Five album routes: `GET /api/capture/albums` (list), `POST /api/capture/albums` (create, server-assigns ID), `POST /api/capture/albums/{id}/assets` (add), `DELETE /api/capture/albums/{id}/assets` (remove), `GET /api/capture/albums/{id}/assets` (list members). Five trash/memories routes: `GET /api/capture/trash` (list), `DELETE /api/capture/assets/{id}` (move to trash), `POST /api/capture/assets/{id}/restore` (restore), `POST /api/capture/assets/{id}/purge` (permanent delete), `GET /api/capture/memories` (on-this-day). New `trash.Purge` method backs the permanent delete route.
  - **`ownerID(r)` bridge in `httpapi/albums.go` and `httpapi/trash.go`.** Closes the Spec 1 §11 `setFavorite` owner-scoping gap. Handlers now accept an `owner` parameter (string) and construct an owner-guarded `r *http.Request` inside the handler body, so both session-auth and device-auth callers call the same handler with their respective owner's ID. Device trash writes (delete/restore/purge) are guarded via `ownsAsset(tx, ownerID, assetID)` — a NEW irreversible purge route deserved explicit owner-scoping even though the implementation plan first said "mount as-is."
  - **Still single-owner-by-design.** `onThisDay` and `listTrash` reads mount unscoped like their session equivalents (no filter on owner_id at query time). Flagged for multi-user work: the session-auth favorite route itself also needs owner-scoping when multi-user lands.
  - **Mobile cache schema v2 (migrations 001→002 in `mobile/src/lib/cache/schema.ts`).** Added `albums` and `album_assets` tables; an atomic key/value wrapper manages the version bump and data migration on each app launch. Mutation queue extended to kinds `album_add`, `album_remove`, `trash`, `restore`, `purge` (added to `mutations.ts` enum); new `routeForMutation(kind)` classifies mutations at flush time and calls the right endpoint. Album creation is online-only — temp-id remap complexity ruled it out for offline queuing. Vitest mocks `expo-secure-store` and `expo-sqlite` so pure logic tests run in node.
  - **Not device-verified.** CI runs tsc + expo lint + vitest only. Physical iOS and Android device pass covered in `mobile/RELEASE_CHECKLIST.md` (Spec 2 test section).

- `feat/mobile-foundation` (2026-07-18) — **Mobile production foundation: generated design tokens,
  Kura/Vault, onboarding gate, connection state machine, offline cache.** Design spec + plan live
  locally in `docs/superpowers/` (gitignored, not in the repo).
  - **Generated design tokens, CI-gated.** `mobile/src/design/tokens.ts` is GENERATED —
    `mobile/scripts/sync-tokens.mjs` parses `web/src/app.css` directly and rewrites it. **Never
    hand-edit `tokens.ts`**; edit `app.css` and re-run `npm run sync-tokens`. `npm run check-tokens`
    (regenerate + `git diff --exit-code`) now gates mobile CI, so a mobile palette that has drifted
    from the web palette fails the build instead of silently diverging.
  - **Auth decision: device-token surface expanded, session auth NOT introduced.** The plan
    considered giving mobile a cookie session like the web client; rejected. A phone must keep
    working for unattended background camera-roll backup, and session auth here is cookie-only with
    a 30-day expiry — wrong shape for a client that runs headless for months. Instead the existing
    device-token model gained one more owner-scoped route (below). If a future task reconsiders this,
    it's a decision, not a bug.
  - **`setFavorite` in `internal/httpapi/favorites.go` is still NOT scoped by `owner_id`** (session
    route, `POST /api/assets/{id}/favorite`) — deliberately left as-is, matching the rest of the
    single-owner-era session API. The **new** capture route, `POST /api/capture/assets/{id}/favorite`
    → `setFavoriteForDevice`, scopes its `UPDATE` to `WHERE id = ? AND owner_id = ?` from the device's
    owner so it's correct even before multi-user lands. Flagged here for whoever unparks multi-user
    (§8 "Sharing & multi-user" row): the session-auth favorite route needs the same `owner_id` scoping
    at that point, not before.
  - **Traps for the next agent:**
    1. Importing a module that transitively loads `expo-sqlite` into the Vitest node environment
       breaks the test run (no native module in node). `mutations.ts` deliberately uses a dynamic
       `import('@/lib/cache/db')` inside its function body instead of a static top-level import, so
       Vitest can exercise the pure mutation-classification logic without ever touching the DB module.
       Keep new cache-adjacent pure-logic modules on the same pattern.
    2. The expo-image disk cache cap is set at **runtime** via `Image.configureCache({ maxDiskSize })`
       — there is no `diskCacheSizeBytes` (or similar) `app.json` plugin key for expo-image. Don't go
       looking for a config-plugin knob; it doesn't exist on this SDK.
    3. The onboarding gate keys on the persisted `setup-complete` flag, **never** on token presence —
       a device can hold a token and still need onboarding (e.g. after a wipe). The flag is read once
       at mount, so any code path that completes setup must explicitly `router.replace('/(app)')`
       rather than relying on the gate to notice a state change.

- `feat/web-kura-vault` (2026-07-17) — **Web design pass: Kura/Vault registers, motion system, gapless grid.**
  Design-only by human decision; no functionality features. Spec + plan live in `docs/superpowers/`
  (gitignored, local). Branch is 3 batched commits: foundation / grid+morph / nav+polish.
  - **Aesthetic:** identity re-derived. Palette keeps shadcn's variable names (renaming breaks every
    shadcn component). `--primary` stays ink so buttons never compete with photographs; `--stamp`
    (oxblood) is new and reserved for Kuraki's own marks; `--highlight` demoted from brand colour to
    FTS5 search-hit highlighting. Type: Public Sans out, Fraunces in for display, Geist Mono new for
    Vault data (rule-6 justification is *meaning* — hashes/paths must disambiguate 0/O and 1/l).
  - **Registers:** one system, two voices, keyed off `<main data-register>` from `lib/nav.ts`.
    Kura (8px rhythm, Fraunces, soft paper) fronts photo surfaces; Vault (4px rhythm, mono data,
    flat hairline panels) backs operational ones. **Colour is shared** — only density/type/surface/
    motion shift. Scoped to shared chrome by human decision; per-route Vault treatment is NOT done.
    **The register rule: register belongs to the page frame, never the photo components.** `AssetGrid`
    and `Viewer` always render Kura — a photograph is a memory even in Trash. Trash/Duplicates are
    Vault frames hosting Kura grids.
  - **Six pre-existing WCAG AA failures fixed**, found by the new gate: `--text-faint` at 3.46:1/3.69:1
    light (needs 4.5), and `--input` at 1.38/1.47 light and 1.66/1.49 dark (1.4.11 needs 3.0 — it is
    the border that identifies a text field, so those were real defects in both themes).
  - **`web/scripts/check-contrast.py` is a gate, not a doc.** It parses tokens straight out of
    `app.css` so it cannot drift from what ships. Run it after any palette change; it exits non-zero.
  - **Traps that bit this work — do not re-introduce:**
    1. Tailwind v4 `@theme inline` **never emits the custom property** — it inlines values into
       utilities. Any token read by hand-written component CSS via `var()` MUST be in plain `:root`.
       This silently killed the motion tokens and `--font-heading`. Build stays green; motion just
       does nothing. Grep the built CSS under `internal/httpapi/assets` to prove emission.
    2. An element's own `box-shadow` paints **beneath** its in-flow children. The tile hairline and
       selection ring are drawn by a positioned `::after` for this reason; a photo covered the
       box-shadow version entirely.
    3. `view-transition-name` must be held by **exactly one** element at a time or the browser
       aborts the whole transition silently. The grid stays mounted under the viewer, so the tag is
       cleared *inside* the transition callback, not after it.
    4. Svelte's `fly`/`fade` are JS-driven and are **not** covered by the global CSS reduced-motion
       rule. They gate themselves via `prefersReducedMotion()` from `lib/motion.ts`.
  - **Not verified:** no browser was available. The morph rendering, reduced-motion skip, Fraunces
    actually loading, keyboard focus on the gapless grid, and the mobile More sheet all need a human
    pass. Opening a photo with zero console warnings is the cheap check that the morph is really
    firing — a "skipped or aborted" warning means it is silently no-op'ing.
  - **Found, deliberately not fixed:** README claims a virtualized timeline that does not exist.
    Logged as a production blocker in ROADMAP.md.

- `working tree` — **Android APK download endpoint.** Public `GET /download/android` (outside `/api`,
  no session — a new phone has no credentials yet) serves an operator-supplied APK from
  `KURAKI_ANDROID_APK` (default `<data>/downloads/kuraki-android.apk`) with
  `application/vnd.android.package-archive` + `attachment` disposition via `http.ServeContent`; a
  missing/unset file returns a friendly 404. Startup now creates `<data>/downloads`. The Caddy `:8080`
  origin proxies `/download/*` to `:3000`, and the web Devices page links "Download the Android app
  (.apk)". Serve-only by design — the APK itself is built out of band (EAS or local Gradle). New
  `internal/httpapi/android.go` + `android_test.go` (present→200 w/ headers, missing→404, unset→404).
  Verified: Go build/vet/tests green; full image rebuilt; APK served identically on :3000 and :8080,
  404 when absent; the built web bundle contains the download link.

- `working tree` — **Hardened phone pairing (hashed, app-only QR).** Pairing codes are now stored
  hashed at rest — `pairing_codes.code` → `code_hash` (migration `00019`, ephemeral table recreated),
  the server persists/looks up only `sha256(code)` like `devices.token_hash`; the plaintext lives only
  in the QR and the claim request. The web Devices page no longer prints the code as text and encodes
  the QR as an opaque `kuraki://pair?d=<base64url(JSON{base_url,code})>` blob, so a generic QR reader
  yields nothing usable — only the app decodes it (`mobile/src/components/pair-scanner.tsx`
  `decodePairing`). `pairing_test.go` now asserts the DB holds the hash, not the plaintext. Verified:
  Go build + pairing/db tests green in a golang:1.26 container; web stage compiles; full
  mint→claim→reuse(409)→unknown(404) round trip passes end-to-end through the container's Caddy :8080
  proxy on a freshly-migrated DB.

- `working tree` — **Dual-origin Docker container.** The image now runs both surfaces in one
  container: `kuraki serve` on `:3000` (Go API + media, embedded UI fallback) and a Caddy static
  server on `:8080` serving the built SvelteKit SPA as its own origin, proxying `/api`, `/healthz`,
  `/metrics` back to `:3000` (mirrors the Vite dev proxy). New `scripts/docker-entrypoint.sh`
  supervises both (bash `wait -n`, SIGTERM forwarding, non-`serve` args still pass through to the
  kuraki CLI so `version`/`import`/`healthcheck` and the container HEALTHCHECK work); new
  `deploy/ui.Caddyfile`; Dockerfile pulls the `caddy:2` static binary and the built UI, EXPOSEs
  `3000 8080`, XDG scratch dirs point at `/tmp`. `docker-compose.yml` and README updated. Verified
  end-to-end: image builds, both ports serve HTTP 200 (direct + proxied + SPA fallback), graceful
  stop in 0.16s. Timeline now supports
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
