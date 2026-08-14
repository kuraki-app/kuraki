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
  with re-geocode, batch timezone shift — the shift had no web caller until 2026-08-12, see §11),
  a library **stats** dashboard; trash + retention + `verify`;
  argon2id auth + login rate-limit; safe-upgrade snapshots; and serving perf (cache headers, gzip,
  SQLite tuning). See [CHANGELOG.md](./CHANGELOG.md) for the full list.
- **Mobile chrome is the platform's, not ours (2026-08-02).** `(app)/_layout.tsx` renders `NativeTabs`
  (the custom split bar described here previously was deleted — see §11, 2026-08-02), and **every tab
  points at a route group that owns a `Stack`**: `(app)/(gallery)/`, `(app)/(albums)/`, `(app)/(search)/`,
  `(app)/settings/`. URLs are unchanged by the parentheses. Headers come from one definition,
  `components/screen-header.tsx` — there is no hand-drawn header bar left in the app, and no screen
  pads by `insets.top` any more. `place`/`tag` push inside the Gallery stack; Trash and Duplicates live
  in the Settings stack. Backup is a **page of Settings**, not a tab. Device tokens and pairing codes
  are never rendered once paired — see `lib/connection-view.ts`. Header actions are `Stack.Toolbar`
  items, never `headerRight` — see §11 (2026-08-02, fifth pass) for why. **All of this is code-complete
  but device-unverified.** Each tab group's list screen must be named `index.tsx`: a tab trigger names
  the *group*, so the Stack picks its own root, and expo-router's last sort tiebreaker is filename
  length — `search.tsx`/`albums.tsx` lost it to `tag.tsx`/`album.tsx` and both tabs opened a detail
  screen with no params. `lib/navigation.test.ts` pins this (see §11, 2026-08-12).
- **A simulator IS available (2026-08-12).** Earlier entries below say "there is no simulator here";
  that was true when written. The current dev machine has Xcode and eight iOS simulators, so mobile
  work can finally be rendered. There is still no Android emulator, and no physical device.
- **Cursor pagination is now real on every list endpoint (2026-08-02).** `getAlbum`, `listFavorites`,
  `listTrash` and `onThisDay` each returned a `next_cursor` they never applied, so following it
  re-served page one. `cursorPredicate` (assets.go) is the shared keyset condition and must stay in
  step with `assetSelectSQLWithJoin`'s ORDER BY. `internal/httpapi/pagination_test.go` walks each
  endpoint to exhaustion and fails if pages repeat. Album membership writes are capped at
  `maxBatchIDs` and run in one transaction.
- **Builds & tests:** `go build ./...`, `go vet ./...`, `gofmt`, `go test -race ./...` all green;
  `npm run build` (web) clean. Cross-compiles linux/amd64+arm64, darwin/arm64, windows/amd64 (CGO off).
- **R1 media core (2026-07-10):** current import admission covers JPEG/PNG/GIF/WebP/HEIC/HEIF/AVIF/TIFF plus MP4/M4V/MOV/WebM. A per-asset capability flag now prevents the viewer from rendering known-incompatible originals: libvips/pure-Go creates image previews where possible, ffprobe identifies browser-compatible video codecs, and ffmpeg creates H.264/AAC playback derivatives otherwise. Failed derivatives remain downloadable and appear in Activity's Media health section. Cross-engine and libvips fixture certification remains env-gated.
- **R1 content admission (2026-07-10):** standard image/video signatures now determine media type before the filename extension; renamed valid media imports with its detected MIME, while mismatched advertised media is recorded as an import error. Opaque camera RAW files retain an extension-based admission exception until a fixture-backed decoder policy is available.
- **Import/export safety (2026-07-10):** browser queue staging isolates each uploaded file, so repeated filenames cannot overwrite one another. Portable backup format v2 records an archive manifest; restore validates it in a temporary sibling directory before swapping into an empty target. `kuraki backup` takes an online SQLite snapshot before packaging a live library. ZIP exports preflight originals and bypass the normal API deadline, so they no longer quietly omit unavailable files or time out at 60 seconds.
- **Capture foundation (2026-07-10):** migration `00012` adds revocable devices and resumable upload sessions. Browser-authenticated users create a device token; `POST/PATCH/complete /api/capture/uploads` writes bounded chunks to staging and hands a complete file to the existing queue/importer. `mobile/` is an Expo/React Native iOS+Android client with SecureStore settings, status receipts, and manual photo selection/upload. It also does automatic camera-roll backup (persisted, restart/network-loss safe), OS background scheduling, streamed large-file uploads, QR pairing, and per-album selection.
  **[CORRECTED 2026-07-30 — "the Capture loop is functionally complete" was overstated and has been removed from this entry.]** An audit against the code found the background task was registered only from the Backup screen's switch handler (so it silently stopped after a reinstall or a device restore), ran **upload only** (server→client sync had no background trigger at all), requested media permissions from a headless context Android cannot serve, and could not read its own credentials on a locked iOS device. Restart-safety was per-file, not per-byte. All fixed in `fix/mobile-android-parity-background-sync` — see §11.
- **Module path:** `github.com/kuraki-app/kuraki`. Migrations through `00024`.
- **The repository is public, and named `kuraki` (2026-08-12).** It had been renamed to
  `kuraki-photos` at some point and was **private**, which is why the README's clone URL, its CI
  badge, and the landing page's only call to action all returned 404 to anyone outside the org —
  the names were survivable (GitHub redirects forever), the visibility was not. Renamed back and
  made public; all three now resolve anonymously. `scripts/check-docs-links.sh` fails CI if a
  documented URL, image path, or relative Markdown link stops resolving.
- **Browser verification is partial:** the merged timeline and Settings routes were smoke-tested at
  a 390×844 viewport on 2026-07-27 (no horizontal overflow; writable restart settings persisted
  with feedback; legacy `/stats` redirect worked; no console warnings/errors). The full media
  viewer/morph, keyboard, reduced-motion, and cross-browser matrix still needs release certification.
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
- **Settings consolidation (2026-07-27, `feat/settings-consolidation`):** the former Stats, account,
  Devices, Activity, appearance, library, and server controls now live under one responsive
  `/settings` shell. Migration `00022` stores the owner-writable catalog; `config.Store` resolves
  defaults < DB < environment/CLI and exposes live versus restart-required values. The OpenAPI
  contract includes settings and device-list endpoints. Security-sensitive `android_apk` remains
  environment-only because `/download/android` is intentionally public.
- **Mobile web overflow fix (2026-07-27, `fix/mobile-responsive`):** timeline headers and filters
  wrap, the app grid uses a zero-minimum content track, batch actions remain visible, and virtualized
  section spacers recalculate across the phone breakpoint/rotation. Verified at 390×844 with
  document/header scroll widths bounded to the viewport.
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
- **Multi-user, isolated libraries (2026-07-27, `feat/multi-user-isolation`):** the seven deferred
  owner-scoping surfaces are closed and a **static guard test** (`ownerscope_guard_test.go`) now fails
  the build on unscoped asset SQL, so the invariant is mechanical rather than a matter of per-handler
  discipline. Migration `00023` adds `users.role`/`disabled_at` and rebuilds `import_state` with a
  `(owner_id, source_path)` key. Sync is per-owner (broker + feed). Admin-managed accounts with
  purge-gated deletion, `kuraki useradd`/`userlist`, and a `/settings/users` pane. An admin manages
  accounts, **not** photos — there is no path from one account to another's library. Sharing and OIDC
  remain parked. Web pane not browser-verified.
- **Mobile Android launch + real background sync (2026-07-30, `fix/mobile-android-parity-background-sync`):**
  the Android app **did not start at all** — `Image.configureCache()` is iOS-only and was called at
  root-layout module scope — and could not have reached a server if it had, because the onboarding
  flow defaults to `http://` while Android blocks cleartext at `targetSdk>=28` (dev-client builds
  inject it, so device testing could not surface this). Both fixed. Background sync now registers at
  launch rather than as a side effect of one tap, drains the delta feed and offline mutation queue
  before uploading, survives locked devices and headless wakes, resumes uploads mid-file, and is
  Wi-Fi-only by default. The uploaded-id ledger moved out of AsyncStorage (Android caps it at 6 MB)
  into its own SQLite file — deliberately not `kuraki.db`, which is a disposable cache. Mobile tests
  went 48 → 65. **Nothing here is device-verified**; see §11 for the four passes a human must do.
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
  migrate/             source-agnostic library migration engine (batching, resume, relations)
  migrate/immich/      read-only Immich REST client + migrate.Source implementation
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
| R2: tags/hierarchical tags, saved searches, archive/hidden, external libraries, backup/restore | ✅ done |
| R2 ratings: filterable and on the DTO since R2, but **no HTTP write path existed** until 2026-08-12 — only the importer and the Immich migration ever set the column | ✅ done (write path + star control added) |
| R2: duplicate review (exact + near-duplicate by hamming), stacks (RAW+JPEG / Live-Motion), whole-library export, scheduled integrity verification | ✅ done |
| Import/export safety: duplicate upload basenames preserved; live backup snapshot; restore staged and manifest-validated; ZIP exports preflighted and unbounded | ✅ done |
| Capture foundation: device tokens, resumable server sessions, React Native status/manual-upload client | ✅ initial slice |
| Automatic camera-roll backup: persisted queue, chunk retry/backoff, restart-safe dedup, needs-attention surface | ✅ done (client) |
| OS background scheduling (expo-background-task) + streamed large-file uploads (expo-file-system handle) | ✅ done (client) |
| Android launch blockers (iOS-only `Image.configureCache` at module scope; cleartext HTTP unconfigured) | ✅ done |
| Background sync completed: launch-time registration, background delta feed + queue drain, headless-safe permissions, locked-device keychain access, mid-file upload resume, Wi-Fi-only default, SQLite upload ledger | ✅ done |
| Mobile cosmetic parity (font weights, Switch colors, video derivative, unused audio permissions, EAS `.aab` vs served `.apk`) | ⬜ deferred by decision |
| Mobile pairing repair: typed pairing-code path, loopback-address guard, copyable code on web, Places no longer crashes the library route | ✅ code-complete, not device-verified |
| Mobile navigation redesign: split tab bar (collapsible pill + search button), search on its own route, Backup folded into Settings, safe areas app-wide, device tokens never rendered | ✅ code-complete, not device-verified |
| Mobile on native controls: NativeTabs (minimizeBehavior + role=search), SwiftUI menu/picker/field, native settings Stack | ✅ code-complete, not device-verified |
| Mobile settings tree: stats index + Backup/Connection/Activity/Notifications/Photo Grid subpages, preference store | ✅ code-complete, not device-verified |
| Mobile local notifications (backup finished/failed, disconnected) for iOS + Android, guarded so Expo Go still runs | ✅ code-complete, needs a dev build to fire |
| Mobile UI defects: 48pt type scale, duplicate headings, "Undated" grouping, media-library deprecation warnings | ✅ fixed |
| One header for every screen (`components/screen-header.tsx`); per-tab route-group stacks; seven hand-rolled bars and all manual `insets.top` deleted | ✅ code-complete, not device-verified |
| Large-title overlap on all six settings pages (ScrollView was not the screen's direct child) | ✅ fixed |
| Navigation theme built from Kuraki tokens (was react-navigation's stock white/black) | ✅ fixed |
| Photo viewer: tap-to-toggle chrome, corner close/favorite icons, bottom details sheet (filename, date, size, place, tags) | ✅ code-complete, not device-verified |
| Album detail promoted from local-state swap to a real pushed route (back button/gesture/Android back now work) | ✅ fixed |
| Remaining picker Modals converted to `@gorhom/bottom-sheet`; modal safe areas; setup steps scroll under the keyboard | ✅ code-complete, not device-verified |
| Selection bars (`selection-bar` + `trash-selection-bar`) still duplicated and pinned above a hardcoded `BottomTabInset` | ⬜ open |
| Web tags UI (browse / per-tag grid / per-asset editing) — server + api.ts existed, no surface called them | ✅ code-complete |
| Web timeline grouping (day/month/year/off) + scroll scrubber; `labelDate` timezone shift fixed | ✅ code-complete |
| Add photos to an album *from inside the album*, both clients; mobile remove-from-album wired | ✅ code-complete, not device-verified |
| Multi-select: explicit `selectionMode`, Select entry point on mobile, Select all/Clear both clients | ✅ code-complete, not device-verified |
| Cursor pagination honoured by album/favorites/trash/memories + clients follow it | ✅ done, tested |
| Album add/remove: `maxBatchIDs` cap + single transaction with prepared statements | ✅ done |
| `taken_at` from the phone's `creationTime` + importer mtime fallback (was: screenshots imported undated) | ✅ done, tested |
| Foreground backup pass on launch/AppState — automatic backup previously waited on an OS window that may never come | ✅ code-complete |
| Settings › Permissions (photo access incl. iOS *limited*, background refresh, notifications) | ✅ code-complete |
| expo-media-library migration to the new class-based API (legacy entry is a documented stopgap) | ⬜ needs a device to verify the backup scan |
| Capture-session expiry sweep (startup + hourly janitor) | ✅ done |
| R1/R2 exit criteria | ✅ met (Takeout + mounted folder re-import without metadata loss; backup/restore on clean instance; org actions on indexed queries) |
| R1 full fixture matrix across libvips and Chromium/Firefox/WebKit | ⬜ env-gated release certification |
| R2 remaining (nice-to-haves): XMP sidecars, non-destructive edit, burst grouping, slideshow/jump-to-date/grid-density/dark-mode/a11y polish | ⬜ roadmap |
| libvips-default Docker image / HEIC verified, low-resource benchmark | ⬜ env-gated |
| QR device pairing: web mints code + QR, mobile scans to claim its own token | ✅ done |
| Per-album backup selection (choose device albums; default whole library) | ✅ done |
| Find: one filter language (q/date/type/camera/favorite/rating/place/album) on paginated /api/search | ✅ done (server); the **web filter bar reached only q/type/favorite/from/to** until 2026-08-12 |
| Find: device-authenticated library read + mobile Library tab (grid, filters, offline cache) | ✅ done |
| Find: web timeline filter bar aligned to mobile | ✅ done |
| Find: opt-in local OCR (tesseract) indexes screenshot/document text into FTS | ✅ done |
| **Maintain**: portable sidecars/manifest, canonical external identity, restore rehearsals, storage forecast | ⬜ release blocker |
| **Harden**: Docker now uses the vips build; duplicate runs, private artifacts, security headers, metrics text, migration regression, and mobile build foundations landed; certification/capacity remain | 🟡 in progress |
| Docker image runs ONE process — `kuraki serve` on :3000 serves API + media + embedded UI (first-run setup included) from a single origin. The dual-origin Caddy :8080 layer was removed once the embedded UI booted correctly (CSP nonce fix); CLI subcommands still pass through the entrypoint. Production HTTPS still fronts it via `deploy/` (proxies to :3000) | ✅ done |
| Phone pairing hardened: codes hashed at rest (code_hash, migration 00019), web shows no plaintext code, QR is an opaque app-only `kuraki://pair?d=…` blob the mobile scanner decodes | ✅ done |
| Public `GET /download/android` serves an operator-supplied APK (KURAKI_ANDROID_APK, default `<data>/downloads/kuraki-android.apk`), linked from Devices; Caddy :8080 proxies /download/*; APK built out of band | ✅ done |
| Web design pass (`feat/web-kura-vault`): Kura/Vault registers, re-derived palette + type, motion system, gapless proof-sheet grid, native View-Transitions morph, grouped nav + mobile tab bar | ✅ **browser-verified** (2026-08-12, `test/web-e2e`) — 51 Playwright tests over a real seeded server |
| Web test infrastructure: Playwright e2e (`make e2e`) + Vitest units + a CI job. Console-error guard fails any test on `console.error`/`pageerror`; `make e2e` refuses to run if `web/src` is newer than the binary | ✅ done |
| Web defects the first browser pass found and fixed: density change blanked the timeline permanently; 13 dangling `label[for]`; scrubber had no `aria-valuetext` at rest; SvelteKit's `Date.now()` version churned all ~100 embedded assets per build | ✅ fixed |
| Web viewer focus management: `trapFocus` action (`web/src/lib/focus.ts`) moves focus in, traps Tab, restores on close — for `Viewer` and `AlbumPhotoPicker`, the two hand-rolled `role="dialog"` surfaces | ✅ done, browser-verified |
| Native `confirm()`/`prompt()` removed from all five routes; `ConfirmDialog`/`PromptDialog` on `ui/dialog`. The e2e console guard now fails any test that triggers a native dialog | ✅ done |
| Web vocabulary: one `SegmentedControl` replacing 4 implementations; `Badge` now carries SettingRow's status pills; dead `Card`/`Separator` deleted; **one breakpoint (820)** — AssetGrid retiled at 780 while everything around it moved at 820 | ✅ done, browser-verified |
| Per-route Vault treatment: `SectionHeading` (micro-caps), mono readouts and 4px rhythm on Overview/Server/Activity/Devices/Users; flat hairline panels replacing lifted cards | ✅ done, browser-verified |
| Web design remainder: splitting Viewer (741) / `+layout` (486) / LibraryView (454) | ⬜ open |
| Public site: Astro, 9 pages (landing + /download + /docs/* + /changelog), canonical from one constant, palette/font/link drift gates, deploy workflow | ✅ done — **needs Cloudflare secrets before CI can publish** |
| Web a11y: 6 pre-existing WCAG AA failures closed (`--text-faint` body contrast; `--input` 1.4.11 control boundary, both themes). `web/scripts/check-contrast.py` gates the palette against `app.css` | ✅ done |
| Web registers applied to **shared chrome only** (PageHeader/cards/EmptyState/`.content`) by human decision; per-route Vault treatment (mono data columns, dense tables, Overview stat tiles) | ⬜ deliberate scope cut |
| **Timeline virtualization** — `AssetGrid` now windows by day-group section (IntersectionObserver + measured-height spacers); on-screen tile DOM stays bounded regardless of library size. Browser-verified: 579 assets / 40 days held constant at ~81 tiles / 6 live sections across all scroll positions | ✅ done |
| Optional local intelligence (faces/semantic), scale (S3/Postgres/hardware) | ⬜ later phases |
| Multi-user (isolated libraries): owner-scoping guard test, roles, admin accounts, per-owner sync | ✅ done |
| Sharing (links, household albums), OIDC | ⏸ parked by decision |
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

| **Immich migration** (`feat/immich-migration`): source-agnostic `internal/migrate` engine + `internal/migrate/immich` REST client; `kuraki migrate immich` / `migrate status`; migration 00021 (`migration_runs`, `migration_map`, `albums.description`, `assets.stack_locked`); `importer.MetadataProvider` seam. Verified end-to-end against a real Immich v3.0.3 in Docker | ✅ done |
| **Settings consolidation** (`feat/settings-consolidation`): one `/settings` shell for overview/account/appearance/library/devices/activity/server; live DB-backed settings store with env/CLI precedence; owner settings + device-list APIs; migration 00022 | ✅ done |
| **Mobile web overflow** (`fix/mobile-responsive`): wrapped timeline controls/batch actions, zero-minimum app track, responsive virtualization spacer estimates | ✅ done; browser-smoked at 390×844 |
| **Mobile tab landing routes** (`fix/mobile-tab-landing-routes`): Search and Albums landed on their *detail* screens because expo-router's last sort tiebreaker is filename length; both list screens renamed to `index.tsx`, missing-param redirect guards on all four detail routes, `navigation.test.ts` pins the invariant using `sortRoutes` itself | ✅ done; not device-verified |
| **Site screenshots & fonts** (`feat/site-screenshots`): the landing page shows the real app for the first time (desktop + phone, WebP, real `alt` text) shot against a throwaway CC0 library, plus `og.png`; fonts moved off `fonts.googleapis.com` to this origin &mdash; **zero third-party requests** | ✅ done; browser-verified, no overflow at 1440 or 390 |
| **Places map basemap** (`fix/places-map-tiles-csp`): the app's own CSP (`img-src 'self' data: blob:`) blocked every OpenStreetMap tile, so the map rendered as bare grey with clusters floating on it since Places shipped; `img-src` now permits the tile host and `TestMapTileHostIsPermitted` checks the CSP against the tile URL in the Svelte source | ✅ done; CSP block confirmed gone, basemap unphotographable in this sandbox |
| **Release pipeline** (`feat/release-pipeline`): `release.yml` is the only workflow that publishes — four archived binaries + `SHA256SUMS` + a GitHub Release, and a **multi-arch** image tagged both `:vX.Y.Z` and `:latest`, built on native amd64/arm64 runners and joined by digest; `ci.yml`'s docker job demoted to build-only; Dockerfile comments corrected (it builds `-tags vips`, not the CGO-free binary) | ✅ done |
| **Canonical identity** (`chore/canonical-identity`): repository renamed back to `kuraki` and made **public**; landing page deployed to Cloudflare Pages (`kuraki.pages.dev`, crawling closed until `kuraki.app` is bound); site CTAs repointed; `.mailmap` collapses four author identities into one; `scripts/check-docs-links.sh` + a CI job fail the build on a dead documented URL, image path, or relative Markdown link | ✅ done; verified anonymously |

Detailed history: [CHANGELOG.md](./CHANGELOG.md). Forward plan: [ROADMAP.md](./ROADMAP.md).
Migration guide: [MIGRATING.md](./MIGRATING.md).

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

- `fix/web-viewer-panel` (2026-08-14) — **The last of the UI pass: a label, a date, and a button that would not stay down.**
  - **The rating had no label** while `TAKEN` and `TAGS` both did, so five outline stars read as loose decoration rather than a field with a value. It now matches its siblings.
  - **`6/30/2025, 12:00:00 PM`.** The viewer called `toLocaleString()` directly, bypassing the `Intl` formatters `format.ts` already owns — the default US pattern, with seconds, on a photograph. New `captureTime()`, unit-tested. **Deliberately NOT changed:** `taken_at` is a true instant (stored UTC) and is formatted in the viewer's zone, so someone in a different timezone from the photo can see a time that disagrees with the `taken_day` heading. Which time a photograph "has" is a product decision, not a formatting bug; the reasoning is recorded next to the formatter rather than silently resolved.
  - **`margin-top: auto` does nothing under `display: grid; align-content: start`** — the rows pack to the top and no free space is distributed, so there is nothing for the auto margin to consume, and Download went on floating mid-panel with a third of the height dead below it. The panel is a flex column now; flex hands the leftover space to the auto margin. Worth remembering: auto margins are a flex idiom, and grid only honours them where the track has slack.
  - **Verified:** `make check`, `npm run check`, 15 Vitest (2 new), **84 Playwright**, `check-contrast.py`, plus the panel screenshotted before and after — the first "fix" for Download passed every gate and changed nothing on screen.

- `feat/web-places-design` (2026-08-14) — **The one screen that looked like it came from a different product.**
  - **Stock Leaflet against warm paper.** Square white buttons with a black border, a blue-link attribution, and a bright blue-and-white basemap, next to soft rounded controls and an oxblood accent everywhere else. The basemap is now toned toward the palette with a **filter on the tile pane** — the tiles themselves are untouched, so no new host and no re-hosting, and the whole treatment is one declaration to remove. Dark mode inverts and re-rotates the hue, then mutes what the inversion oversaturates.
  - **An empty world map reads as broken, not as "no photos carry GPS".** With nothing located there is now no map at all — not hidden, never built, so Leaflet does not fetch tiles for a picture of nowhere — and an EmptyState explains where GPS comes from. `map` is created after `await tick()`, because the container only exists once the count is known.
  - **Specificity was the whole game on the zoom buttons, and the first attempt changed nothing visible.** Leaflet sizes them with `.leaflet-touch .leaflet-bar a` (0,2,0) and `.leaflet-bar a` (0,1,1); a plain `.leaflet-control-zoom a` is also (0,1,1) and loses on source order. Matching Leaflet's own selectors wins without `!important`. They were 30×30, below any target floor, and they are the map's only controls.
  - **A regression of mine, found in the screenshot.** Adding "View photos" to each place row left the name about 50px wide, and `overflow-wrap: anywhere` then broke cities mid-word — "Kyot / o", "Naga / hama". `anywhere` breaks between any two characters the moment a box is tight; `break-word` only breaks a word that genuinely cannot fit alone. The card grid also went 220px → 280px, and the row wraps so the link drops below the name instead of squeezing it.
  - **Two process notes, both of which cost a full screenshot cycle.** A backgrounded `kuraki serve` keeps serving the **embedded assets it started with**, so `make web build` alone proves nothing — the server has to be restarted. And `cd web && python3 …` inside a shell already in `web/` fails the `cd` and, with `&&`, silently skips the edit; the "fix" then appears not to work. Use absolute paths.
  - **Verified:** `make check`, `npm run check`, 13 Vitest, **84 Playwright** (2 new), `check-contrast.py`, plus both states screenshotted — the empty page and a real located map, seeded through the GPS patch path because EXIF-less fixtures cannot carry coordinates.

- `fix/web-mobile-header` (2026-08-14) — **The timeline's controls outranked the timeline on a phone.**
  - **Four stacked control rows, ~24% of a 390×844 screen, before a single photograph** — title, search, filters, density. Now two: title + Select, then search sharing a row with the filter and saved-search buttons. Photos start ~170px down instead of past 200 with a whole row of preferences above them.
  - **Grid density left the phone entirely.** It is set once and never touched again, it was claiming a full row above the photographs, and its segments were 36×28 — the worst targets in the app. It stays in Settings → Appearance, and a test asserts it is still there as well as gone from the header.
  - **Jump-to-date folded into the Filters panel**, which already has From and To. A bare `dd/mm/yyyy` field reads as a form to fill in rather than a way to jump, and it cost a full row to say so.
  - **`pointer: coarse`, not a width breakpoint, is the honest test for touch targets.** It asks how the device is actually being driven, so a touchscreen laptop gets the larger target and a narrow desktop window does not. Buttons and nav links get a 44px floor under it (Apple HIG, satisfies WCAG 2.5.5). **`.tile` is excluded**: a grid tile is a photograph, not a control, and a min-height would fight the square aspect ratio the gapless grid depends on. Prose links inside a paragraph are excluded too — padding a word mid-sentence into a 44px block wrecks the paragraph and helps nobody.
  - **The measurement trap worth remembering.** The first assertion reported photos starting **1784px** down a page whose header is ~170px. Nothing was wrong with the layout: `LibraryView` crossfades the skeleton out over 240ms, so for that window *both* grids are in the DOM and the real one sits below the placeholder. Waiting for the skeleton to detach is the honest settle signal; measuring geometry before it is measuring a transient.
  - **Two setting descriptions became false and were rewritten.** "Also available from the sidebar" (Theme) and "Also available above the timeline" (Grid density) both pointed at controls that do not exist on a phone — and the second was made false by this very change. A description should describe the setting, not give directions to another screen that may not have it.
  - **Verified:** `make check`, `npm run check`, 13 Vitest, **82 Playwright** (4 new, run with `hasTouch`/`isMobile` so the coarse-pointer rules actually apply), `check-contrast.py`, both palette gates, plus touch-device screenshots read by eye — which is what caught the false copy.

- `fix/web-empty-states` (2026-08-14) — **Every empty list was a dead end, and the component had the slots to fix it all along.**
  - **Found by looking, not by testing.** A browser pass over every route at 1440 and 390 — `/albums` rendered the words "No albums yet" alone in ~700px of paper, with the New album button sitting unmentioned in the corner. `EmptyState` accepted an `icon` slot that had **zero consumers anywhere**, and 6 of 9 call sites passed a bare `title`. `LibraryView` forwarded one string, which is why timeline, favorites, memories, archive, hidden and trash were identically bare. These are first-run screens: it was the first thing a new library showed.
  - **The centring was its own bug.** `EmptyState` used `place-items: center` over a tall min-height, so on `/tags` the message floated ~200px below the "New tag" form it was talking about and read as an unrelated notice. It is now anchored under its content, and a test asserts the gap stays under 160px.
  - **`requestUpload()` — the timeline could describe the Upload button but not be one.** The file input lives in the root layout because the drop target is the whole window, so an empty timeline had no way to offer the action that fixes it. A store bump the layout subscribes to closes that; the initial value is skipped so mounting a page never opens a file picker.
  - **Two different empty states on one route.** "No photos yet" and "no results for these filters" are not the same screen and now say different things — the filtered one offers **Clear filters**, which is the action that resolves it.
  - **A regression of mine, caught in the same screenshot.** Making filter labels siblings of their controls (the earlier filter-bar work) let a flex-wrap break land between them — "City" ended up at the end of one row with its input on the next. Each pair is now wrapped in `.field`.
  - **Four specs needed updating and one needed a guard.** Copy changes broke three assertions, `/albums` legitimately has two "New album" buttons now (header + empty state), and `boot.spec`'s expired-session test began failing the console guard with 20–28 × 401 — every request in flight across a reload that deliberately destroys the session. The count varies run to run because it races the reload, which is why it is declared per-test rather than counted. **A stray 401 anywhere else still fails.**
  - **Verified:** `make check`, `npm run check`, 13 Vitest, **78 Playwright** (9 new), `check-contrast.py`, plus screenshots of every changed empty state read by eye. Remaining from the UI plan (`docs/superpowers/plans/2026-08-14-web-ui-ux-pass.md`, local): the mobile header, Places' stock-Leaflet chrome, and the viewer panel.

- `feat/web-vault-settings` (2026-08-13) — **The register finally reaches the page contents, and the seam held.**
  - **The scope cut was real and specific.** Only three components ever read the `--frame-*` tokens (PageHeader, EmptyState, StatCard), so the Vault register stopped at the page frame. Every settings page then hardcoded its own spacing (12/14/16px), radius (10/12px) and section headings (five variants, 14–16px bold sans) — Kura values on the most operator-facing pages in the app.
  - **`SectionHeading` is a component and NOT a `[data-register='vault'] h2` rule, deliberately.** `AssetGrid` renders day headers as `<h2>`, and Trash and Duplicates are Vault *frames* hosting a Kura grid — a register-keyed element selector would have restyled those day headers into mono micro-caps and broken the one rule the system rests on. (Trash currently renders ungrouped so no `h2` is emitted today, which means the bug would have been latent rather than visible — the worst kind.) Opting in explicitly is what keeps the seam intact, and `e2e/registers.spec.ts` now pins it from both sides.
  - **Mono is for readouts, not for prose, and the screenshot is what caught it.** The Backup panel's "Automatic backup is off. Set a backup directory in Settings → Server…" is a sentence, and setting it in the data face made it harder to read while saying nothing true about it. The explanatory branches take `.prose`; counts, sizes and timestamps keep the mono face. The spec's wording is the test: mono is for "hashes, paths, counts, IDs".
  - **A spec-vs-build gap found on the way past.** §3.5's type table lists "day headers" under Fraunces, and `AssetGrid` was rendering them at 15px/700 in the inherited sans. It had never been noticed because nothing compares the two faces side by side except an eye in a browser. Day headers now use `--font-heading`. **This is the one change here that touches the photo-facing surface** rather than settings, so it is worth a human look.
  - **Verified:** `make check`, `npm run check`, `check-contrast.py`, 13 Vitest, **70 Playwright** (4 new register tests), plus screenshots of Overview/Server/Activity/Users/Timeline read by eye — which is what caught the prose-in-mono problem that every test passed straight through.

- `feat/web-design-vocabulary` (2026-08-12) — **Four implementations of one control, two dead primitives, and two breakpoints pretending to be one.**
  - **`SegmentedControl` replaces `.seg` (settings/appearance), `.theme` (MobileNav), the density group (LibraryView) and the type chips (timeline).** They differed in padding, radius and fill, but the difference that mattered was semantic: two set `aria-pressed`, two rendered a row of anonymous buttons inside an unlabelled div. The control takes `role="group"` plus a caller-supplied label, and its radius comes from `--frame-radius`, so it takes the register of whatever page it lands on instead of hardcoding 8px in three places.
  - **Media type and Favorites were one row of four identical pills and are not the same kind of thing.** Three mutually exclusive options are a segmented control; Favorites is an independent toggle and stays a `FilterChip`.
  - **Consolidation created a defect that the test caught immediately.** `SettingRow kind="group"` wraps its slot in `role="group" aria-labelledby`, and the new control adds its own — so every appearance row became two nested groups with the same name, which a screen reader reads twice. `kind` now documents that `group` is for *bare* controls only, and rows whose slot labels itself use `static`.
  - **`Badge` had zero consumers while SettingRow hand-rolled three coloured paragraphs** for applied / pending-restart / pinned. A status pill is what a badge is. `Card` and `Separator` also had zero consumers and were deleted rather than retrofitted speculatively — `npx shadcn-svelte add card` brings either back the moment something needs it, and a component directory that advertises a system nothing uses is worse than a smaller one.
  - **One breakpoint now, and the 780/820 split was a real rendering seam.** `AssetGrid` retiled at 780 while its own header, `ScrollScrubber`, `BatchBar` and the settings rail all reflowed at 820 — so 780–820px rendered a page that was half mobile, tiles already narrowed and nothing around them moved. All of it is 820. **The seam is documented in `app.css` as a comment, not a token: `@media (max-width: var(--bp-mobile))` is not valid CSS**, so each component must write the literal and the comment is where the number is agreed. `AssetGrid` also mirrors it in JS as `NARROW_MAX`, because its spacer-height estimate has to know which tile size the CSS is about to use.
  - **Verified:** `make check`, `npm run check`, 13 Vitest, **66 Playwright**, `check-contrast.py`, and both palette gates (`mobile/check-tokens`, `site/check-tokens`) — the app.css edit is comment-only, and the gates prove it.

- `feat/site-multipage` (2026-08-12) — **The site became a site: nine pages, real docs, a download page, and three gates it never had.**
  - **Astro, and the tradeoff is explicit.** `site/` was one hand-written 637-line `index.html` with no build step, and that property is now gone — there is a `package.json` and a `node_modules`. What the *output* keeps is what the page's own argument depends on: static HTML, self-hosted fonts, and **zero third-party requests**, verified in a browser rather than asserted (`grep` for CDN hosts finds nothing, and a Chromium run recorded no request off-origin).
  - **The canonical URL now has exactly one source.** The old page hardcoded `https://kuraki.app/` into its canonical link, `og:url` and `og:image` while being served from `kuraki.pages.dev` — so the deployed page advertised a canonical that does not resolve and an OG image that 404s, which is *why* `robots.txt` closes crawling. Everything now derives from `site` in `astro.config.mjs` (overridable via `SITE_URL`). Binding the domain is one constant plus opening robots; the file documents the exact two steps.
  - **Docs link to the repository rather than restating it.** Install/import/migrate/configuration/backup are short pages that hand off to `README.md`, `MIGRATING.md`, `DEPLOYMENT.md`, `MEDIA_SUPPORT.md` — the canonical copies `scripts/check-docs-links.sh` already guards. Two copies of the same install instructions drift within one release. `/changelog` is rendered from `CHANGELOG.md` at build time for the same reason.
  - **Three gates, and two of them were verified to bite by planting a defect.** `site/scripts/check-tokens.mjs` (palette drift against `web/src/app.css`), `site/scripts/check-fonts.mjs` (the vendored woff2 must stay byte-identical to what `web/` vendors), and `check-docs-links.sh` extended to resolve every internal site link against routes derived from the filesystem — it only read Markdown before, so `site/` was unguarded by the very script that exists to stop dead links.
  - **The token gate failed on its first run against a correct stylesheet, twice, and both causes are worth knowing.** (1) Both files declare `:root` a *second* time inside `@media (prefers-color-scheme: dark)`, so taking the last match read the dark palette and reported every light token as drifted. (2) `app.css` documents `--stamp` with the prose "Deliberately NOT `--primary`: as the button fill it would compete with the photographs" — and a declaration regex reads `--primary:` there as a real token whose value runs to the next semicolon, swallowing the actual `--stamp` line and reporting it absent from a file that plainly defines it. **Comments in a stylesheet are data.** The parser now strips comments and brace-matches the first top-level `:root`.
  - **`git add -A` swept in `site/node_modules`** — `.gitignore` covered `web/node_modules` only. Caught by the link checker suddenly reporting failures inside `undici` and `sitemap` READMEs. Same lesson as the `.wrangler/cache` incident: read the status before trusting `-A`.
  - **Deploy is a workflow now, but it cannot publish yet.** `.github/workflows/deploy-site.yml` builds and runs all three gates on every push to `site/**`; the publish step is guarded on `CLOUDFLARE_API_TOKEN` existing. **A human must mint a scoped Pages token and add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as repository secrets** — the wrangler OAuth login used locally provides neither (this was already recorded here and has not changed).
  - **Verified:** `astro build` (9 pages), all three gates, and a Chromium pass over every page asserting a heading, the primary nav, no horizontal overflow at 390/800/1440, the self-hosted font actually resolving, and the canonical coming from the one constant. **Not done:** the site is not deployed from CI yet (needs the secrets), `site/shots/*` are still the hand-captured images rather than regenerated from the web e2e suite, and no page has been read by a human for tone.

- `feat/web-design-consistency` (2026-08-12) — **Focus management for the two hand-rolled dialogs, and the end of native `confirm()`.**
  - **A focus-trap action, not a move to `ui/dialog`, and the reason is the morph.** The viewer is the target of the native View-Transitions grid→viewer animation. Wrapping it in bits-ui puts a portal and a managed overlay between the tile and the element carrying `view-transition-name`, which is the one thing that animation cannot survive. `web/src/lib/focus.ts` gives the same three guarantees to any element with `role="dialog"`; `AlbumPicker`/`ConfirmDialog` keep getting them from bits-ui.
  - **The focus move is deferred one frame, deliberately.** The dialog's children mount with it, so on the first tick `focusable()` sees an empty subtree and there is nothing to focus. The e2e assertion therefore polls rather than reading once — a test that read it synchronously failed against a *working* implementation, which is worth knowing before someone "fixes" the action.
  - **Restore is guarded on `document.contains`.** The grid virtualizes by section, so the tile the viewer was opened from can be unmounted while it is open. Focusing a detached node silently sends focus to `<body>` — precisely the failure the action exists to prevent.
  - **Native dialogs are now a test failure, not a review comment.** Playwright auto-dismisses `alert`/`confirm`/`prompt`, so a reintroduced `confirm()` would not fail anything — it would make the action silently never happen and leave the *next* assertion to report a mystery. The console guard now listens for `dialog` and fails the test that raised it.
  - **Verified:** `make check`, `npm run check`, 13 Vitest, **62 Playwright, zero skipped** — the viewer focus `test.fixme` from the previous branch is now a passing test asserting all three conditions.

- `feat/web-capability-gaps` (2026-08-12) — **The server could already do most of this; the web UI just had no way to ask.**
  - **Archive and Hidden were one-way doors.** `unarchive`/`unhide` have been implemented in `batch.go` since batch ops existed, and were even typed in `web/src/lib/api.ts` — with zero callers. So a photo sent to either place could not be brought back from the web at all. The mobile client shipped `unarchive` deliberately "because shipping it without unarchive would make the action a one-way door"; web simply never did. `BatchBar` now takes `archiveMode`/`hiddenMode` alongside the existing `trashMode`/`albumMode`, and offers the way out instead of the way further in.
  - **The trash could not be emptied.** `DELETE /api/trash/{id}` existed and only the phone app called it, so a web user could never reclaim disk space before the retention window elapsed. Added a **batch `purge` op** rather than looping the single-asset route — emptying a 500-item trash would otherwise be 500 requests. `trash.Purge` already logs its own `change_log` row, so `logsHere` stays false for it; the test counts delete rows *before and after* the purge, because trashing an asset also logs a delete and a naive total would read 4 where 2 is correct.
  - **The trash page lied about its own retention.** The subtitle hardcoded "permanently removed after 30 days" while `trash_retention_days` is live and owner-editable, so it was wrong the moment anyone changed it. It now reads the setting.
  - **Ratings were readable, filterable, and unwritable.** `rating` was on the DTO and in `parseAssetFilters` from the start, but nothing except the importer and the Immich migration ever wrote the column — there was no PATCH field. Added `Rating *int` (0–5, rejected outside that range rather than clamped: a 9-star photo is invisible to every "n and up" filter), written by its **own statement** so a rating-only patch cannot blank a caption or capture date the caller never mentioned. The star control lives beside Favorite in the viewer, not inside the edit form — a rating is a one-click judgement. Clicking the current rating clears it, or 1 star would be its own one-way door.
  - **Most of the filter language was unreachable.** The panel exposed `q/type/favorite/from/to`; the server accepted camera, rating, place_city, place_country, tag and album too, and a saved search could carry filters the UI could neither display nor clear. All of them now have controls, the timeline reads filters from the **query string** (so Places tiles link into a filtered grid, which is what mobile has always done — `focusPlace` only panned the map), and the summary line names every active filter.
  - **Explicit `for`/`id` on every filter control, and the reason is not style.** A `<label>` that *wraps* a `<select>` takes the option text into its own accessible name, so "Rating" was announced as "Rating Any 1★ and up 2★ and up …". `getByLabel('Rating', {exact: true})` failing is what surfaced it.
  - **External libraries could be added but never removed**, so a mistyped root path was permanent. New `DELETE /api/external-libraries/{id}` removes the library and its indexed rows — **never the files**, which Kuraki does not own and never copied. The rows must go explicitly: `assets.external_library_id` is `ON DELETE SET NULL`, so leaving them would produce orphans indistinguishable from ordinary imports pointing under an untracked root.
  - **`duplicates.Run` had no json tags**, so it serialized as `ID`/`Status`/`Groups` — the only non-snake_case DTO in the API. Nothing consumed it (the web client typed `run` away entirely, which is why an empty Duplicates page could not distinguish "never scanned" from "scan running" from "none found"), so naming it properly cost nothing.
  - **A permanent delete in the test suite is a permanent delete.** The Empty-trash e2e test purges a fixture asset, so the library is smaller for every spec that runs after it — `select.spec` asserting a hardcoded 36 passed alone and failed in the full run. Count assertions now read the total off the page. Worth remembering for any future spec: this suite shares one library and runs serially, and only irreversible operations can actually strand it.
  - **Verified:** `make check` (6 new Go tests), `make check-gen`, `npm run check`, 13 Vitest, **58 Playwright** (1 fixme). **Not done here:** `POST /api/backup/run` and the Places `truncated` flag, both still open from the plan; backup *restore* stays CLI-only by decision — a one-click path that swaps the live data directory does not belong behind a session cookie.

- `test/web-e2e` (2026-08-12) — **A browser rendered this UI for the first time, and it found four real defects in the first hour.**
  - **The suite drives the Go binary, not `vite dev`.** The SPA is served by `internal/httpapi` under a strict CSP with a per-request script nonce, and that is the document production ships; Vite's dev server would exercise a page nobody is served. `web/e2e/server.mjs` seeds a throwaway library and `exec`s `kuraki serve`. Seeding order is load-bearing: `kuraki import` creates the placeholder owner row, and `POST /api/setup` *claims* that row, so importing first and running first-run setup through the UI afterwards leaves the assets owned by the account the tests sign in as. Reversed, you sign in to an empty library.
  - **Grid density permanently blanked the timeline, and only a browser could see it.** `AssetGrid` cleared the virtualizer's `visible` set whenever density changed. But IntersectionObserver reports *changes* in intersection, never current state on demand — and a density change keeps the same section keys and the same DOM nodes, so nothing re-fired and the set was never refilled. Every section unmaterialized: 9 sections, 0 tiles, and **scrolling did not recover it**. Grouping changes survived the identical code path only because they rewrite every section key, which remounts the nodes. Now cleared only when the grouping actually changed.
  - **13 `<label for>` attributes pointed at nothing.** `SettingRow` documents the contract "callers pass the same value as the control's own id", and every caller but one ignored it — clicking the label did nothing and assistive tech announced an unlabelled control. There were three distinct shapes hiding behind one prop, so `SettingRow` gained `kind`: `control` (one labelable element), `group` (a segmented set — `for` can only point at one, so the slot becomes `role="group"` + `aria-labelledby`), and `static` (a rendered value like the version string, which can never be labelled by `for` at all).
  - **Reproducible builds, by deleting a timestamp.** SvelteKit's default `version.name` is `Date.now()`, baked into the bundle, so every build changed every content hash and rewrote ~100 files under the **committed** `internal/httpapi/assets`. The version is only read by the `updated` store, which nothing in `web/src` imports — the app ships inside the binary, so "new version" and "new binary" are the same event. Pinned to a constant; identical source now yields byte-identical assets. **That is what makes the new CI drift gate possible at all** — it was verified by building twice and comparing, and the first attempt at the gate was abandoned when that comparison failed.
  - **Two "failures" were the test being wrong, and both are worth remembering.** The scroll scrubber hides itself below 2000px of scrollable content, so on a 36-asset library at 1280×900 it is correctly absent — the spec now asserts both sides of that threshold. And a bare `.grid` selector also matches Tailwind's `grid` utility, which LibraryView uses on its skeleton and error wrappers, so it silently asserted against the wrong element; scope grid assertions to `.day-inner .grid`.
  - **The viewer does no focus management whatsoever, and the obvious test would have missed it.** Measured with the dialog open and 7 tabbable controls inside it, `document.activeElement` is still the grid tile *behind* the overlay. So focus never enters the dialog, is not trapped, and "restore focus on close" **passes vacuously** — focus returns to the tile only because it never left. Asserting restore alone would have certified this component as correct. Left as a `test.fixme` naming all three conditions; it closes when the hand-rolled dialogs move to `ui/dialog`, which gives all three for free (as `AlbumPicker` already shows).
  - **The console guard is the cheapest thing here.** Any `console.error` or uncaught exception fails the test that provoked it. A test that navigates and asserts nothing still earns its keep, because until now an exception on mount had nowhere to surface: `npm run build` does not typecheck and `svelte-check` cannot see runtime. Tests that provoke an error deliberately (the wrong-password 401) declare it per-test via `consoleGuard.allow()` rather than widening the global allowlist, which would hide the same failure everywhere else.
  - **Verified:** `make check`, `npm run check`, 13 Vitest units, 51 Playwright tests (1 fixme). The unit tests run in `America/Los_Angeles` on purpose — the `taken_day` timezone bug they pin is invisible at UTC or any positive offset, including this machine's +05:30 — and were confirmed to bite by deleting `timeZone: 'UTC'` and watching exactly 3 fail. **Not covered:** Firefox/WebKit, the Places basemap (no route to `tile.openstreetmap.org` from here), and upload/import through the browser.

- `feat/site-screenshots` (2026-08-12) — **The landing page for a photo product contained no photographs, and phoned Google to render its own headline.**
  - **The library it had to be shot against was the real obstacle, not the tooling.** `kuraki-data/` holds 21 assets and every one is a screenshot of a software UI — Dynamic Island mockups, media players, terminal output — with no GPS and no date spread. So Places rendered "0 located photos", On this day and Albums were empty, and the timeline was a wall of dark rectangles. Cropping does not fix content. The screenshots are taken against a **throwaway library** (`/tmp/demodata`, a fresh `kuraki useradd`) holding 24 **CC0** photographs pulled through Openverse; the owner's own library is never touched and never appears on a public page. `site/shots/CREDITS.md` records provenance even though CC0 requires none.
  - **Seeding metadata is what made the product look like itself.** Imported photographs alone still left Places empty and every date in one clump. Coordinates are set through `PATCH /api/assets/{id}` and **Kuraki reverse-geocodes them itself**, so "Bergen · Norway" and "Cape Town · South Africa" on the page come from the product rather than from a fixture. Dates are clustered into three *trips* rather than spread evenly: one photo per day gives every photo its own day header and a single tile, which reads as an empty app. Eight per day fills the proof-sheet row at 1440px.
  - **Two capture bugs worth remembering.** `deviceScaleFactor` is a Playwright **context** option; nested inside `viewport` it is silently ignored and every screenshot comes out at 1x — the phone shot was 390×844 instead of 1170×2532 and would have shipped visibly soft. And `sips` on macOS cannot write WebP, so encoding goes through `sharp`.
  - **Fonts now come from this origin.** The page loaded Fraunces, Geist and Geist Mono from `fonts.googleapis.com` — a render-blocking third-party request on a page arguing that your photos should not live on someone else's computer. They are the same `@fontsource-variable` files `web/` already vendors. Verified with a request-level check: **zero third-party hosts**, all three faces loading, `document.fonts.check('600 48px Fraunces')` true.
  - **Places is deliberately not on the page.** Its basemap cannot be photographed from this sandbox (see the CSP entry below), so the only honest Places screenshot available would show grey. Add it once a machine that can reach the tile host takes the shot.

- `fix/places-map-tiles-csp` (2026-08-12) — **The Places basemap has never rendered for anyone. The app's own CSP blocked it, from the day Places shipped.**
  - **`img-src 'self' data: blob:` versus `L.tileLayer('https://{s}.tile.openstreetmap.org/…')`.** Two files disagreeing, with nothing connecting them. Every tile request was refused by the browser, so the map drew as bare grey with the marker clusters floating on it and the place list — same-origin thumbnails — looking perfectly fine underneath. That combination is why it never read as broken: the page has content, just no map.
  - **Nothing in the toolchain could have caught it.** `go test` does not know the Svelte file exists; `svelte-check` and a clean `npm run build` do not know the CSP exists; the CSP had tests, and they asserted the directives were *present*, not that they permitted what the app asks for. It took a browser, and until this session the project had never rendered itself.
  - **The test therefore checks the two files against each other**, not against a constant: `TestMapTileHostIsPermitted` reads `web/src/routes/places/+page.svelte`, extracts the tile host from the actual `L.tileLayer` call, strips Leaflet's `{s}` placeholder, and asserts `img-src` permits it. Verified it bites by reverting the fix — `map requests tiles from "tile.openstreetmap.org" but img-src does not permit it`. It fails loudly rather than skipping if the `tileLayer` call disappears, because at that point its premise is gone and it should be rewritten alongside whatever replaced it.
  - **This is a deliberate third-party exception, and worth being honest about.** One host, images only. A browser viewing Places now reveals the approximate area being viewed to openstreetmap.org. The project already accepts that on mobile via OpenFreeMap; proxying tiles through the Kuraki host would remove the exception and is the better long-term answer. It also sharpens the audit's "two map stacks" finding — web/leaflet and mobile/MapLibre are not just duplicated work, they are two separate third-party relationships.
  - **Verified as far as this environment allows.** The browser error changed from `csp` to a network error, the served header now carries the host, and the guard test fails without the fix. A *rendered* basemap could not be photographed here: Chromium cannot reach `tile.openstreetmap.org` from this sandbox even though `curl` gets 200 from it, and a browser user-agent does not change that.

- `feat/release-pipeline` (2026-08-12) — **Nothing had ever been published, and the Dockerfile's own header described a build it stopped doing.**
  - **`ci.yml` was the publisher, and it could not produce what the README advertises.** It pushed on `v*` tags only, tagged with the version and never `:latest` — the tag `docker run ghcr.io/kuraki-app/kuraki:latest` names. Its cross-compiled binaries were CI artifacts: behind a login, expiring. Publishing now lives in `release.yml` alone and the docker job is `push: false`, build-validation only. `packages: write` was dropped from `ci.yml` with it.
  - **Multi-arch is built on native runners, not QEMU.** The Dockerfile compiles with `CGO_ENABLED=1 -tags vips`, so emulating arm64 would mean a cross-compiled cgo build on every release. Public repositories get free `ubuntu-24.04-arm`, so each architecture builds on its own hardware, is pushed **by digest with no tag**, and the two are joined by `docker buildx imagetools create`. Tagging inside the per-arch jobs would publish whichever finished last rather than a manifest.
  - **The release binaries build the web UI first; the CI ones deliberately do not.** `internal/httpapi/assets` is **committed** (111 files) and nothing checks it against a fresh build — `make check-gen` covers the OpenAPI contract and client types, not the embedded UI. So the committed assets can drift from `web/` silently, and a release that skipped the web build would ship whatever UI was last committed rather than the tagged one. `ci.yml` can keep skipping it because it only proves the Go code compiles.
  - **The Dockerfile header was wrong about the Dockerfile.** It said the image "builds the default CGO-free binary" and that libvips "is not linked by this default binary", while the build stage has been doing `CGO_ENABLED=1 go build -tags vips` against `libvips-dev`. That is the exact claim ROADMAP's first production blocker is about, so the comment was actively misleading about the thing under audit. Corrected in place; `libvips42` in the runtime stage is a hard dependency, not a provision for later.
  - **Release notes come from `CHANGELOG.md`, with a proven fallback.** An awk extracts the section for the tag; it stops at the next `## [` **and** at the trailing link-reference definitions, because the newest section has no heading after it and the notes otherwise trailed off into `[0.1.0]: https://…`. Both branches were run against the real file before committing — the matching version yields 263 lines with zero leaked link definitions, and an absent version yields 0 bytes, which flips the workflow to `--generate-notes` so a release is never published with an empty body.
  - **The dry run could not have caught the one bug there was, and that is the lesson.** Every publishing step is guarded on `github.ref_type == 'tag'`, so `workflow_dispatch` proved four binaries and both native-runner images build — and skipped the digest export entirely. On the real tag it failed immediately: the digest is `sha256:<hex>` and it was used verbatim as a filename, which `upload-artifact` rejects for containing a colon. **A dry run that skips the publishing steps proves the build, not the release.** The images had already been pushed by digest when it failed, so nothing was half-published; the tag was moved rather than a `v0.1.1` burned on a workflow typo, because no release had been created.
  - **`workflow_dispatch` exists so the build path can be proven before a tag makes it permanent.** Every publishing step is guarded on `github.ref_type == 'tag'`, so a manual run builds binaries and both images and pushes nothing. Note the constraint that forced the ordering: `workflow_dispatch` only works once the file is on the default branch, so this must merge before it can be tested.

- `chore/canonical-identity` (2026-08-12) — **Every advertised way to obtain Kuraki returned 404, and the cause was visibility, not the three conflicting names.**
  - **The diagnosis that mattered was the one that changed.** The README cloned `kuraki-app/kuraki`, the landing page linked `kuraki-app/kuraki-photos`, and the Docker line named a third path — so this read as name drift. It was not. `gh api repos/kuraki-app/kuraki` resolves to `kuraki-app/kuraki-photos`: the repository had been *renamed* and GitHub redirects the old name forever, so every one of those URLs would have worked. They 404'd because the repository was **private**. Naming was cosmetic; visibility was the bug. Worth remembering as a method note — an anonymous `curl` distinguishes "wrong URL" from "no access", and an authenticated `gh` call cannot, because it succeeds either way.
  - **The rename was still worth doing, and it paid for itself.** `go.mod` already declared `github.com/kuraki-app/kuraki`, so renaming the repository back made the module path correct instead of requiring an import rewrite across 81 files and a regenerated contract — and `ci.yml`'s `ghcr.io/${{ github.repository }}` began resolving to the exact image path the README already advertised. The README needed **zero** edits as a result; only the six site CTAs did.
  - **History was scanned before the flip, and that ordering is the point.** Making a private repository public exposes every commit ever made, not the current tree, and unpublishing does not un-leak what was fetched. 256 commits / 3.96 MiB: no credentials under high-signal or generic patterns, no `kuraki-data`/`prod-builds`/`bin`/`docs`/`node_modules`/`.DS_Store` ever committed, no `/Users/…` paths, no real hosts in `deploy/`. Clean — but the check is what licensed the flip, not the result.
  - **`.mailmap` rather than a rewrite.** Four author identities existed, one of them a machine hostname (`saranshh@MAM5.local`) that would have been visible on ten public commits. A mailmap collapses all 256 to one author in `git log`, `git shortlog` and GitHub's attribution **without rewriting a single SHA**. The 21 pre-existing AI co-author trailers (17 Claude, 4 Codex) were deliberately left: they contradict the current CLAUDE.md policy, but stripping them means rewriting all 256 commits for cosmetics, and the policy already prevents new ones.
  - **`scripts/check-docs-links.sh` checks links, not mentions.** AGENTS.md §11 records the old repository name as history and is right to; a *URL* naming it is dead. So the guard matches `(github.com|ghcr.io)/owner/<stale>` rather than the bare string, compares every concrete `ghcr.io/…` against the published image, and resolves every relative Markdown link (33 today). It skips `ghcr.io/${{ … }}` template forms, which Actions resolves correctly by construction, and excludes itself from its own search — it necessarily contains the strings it hunts for. **Verified it bites** by planting all three defects in a tracked file and watching each fail.
  - **The site is live at `kuraki.pages.dev`, and `robots.txt` closes crawling on purpose.** `index.html` declares `https://kuraki.app/` as its canonical URL and that domain is not registered, so indexing the temporary Pages address would publish a page pointing at a dead canonical and then require a migration. The file carries the one-line change to make when the real domain is bound. Deployment is **manual** (`wrangler pages deploy site`) — automating it needs either a Cloudflare API token as a repository secret or the dashboard's Git integration, and the OAuth login used here provides neither.
  - **`git add -A` swept in `.wrangler/cache/`.** No credentials — an account id and an email-derived account name — but it is machine state, and the account name embeds an address. Caught before the push and now gitignored. Worth the habit: after any tool authenticates inside the working directory, read `git show --stat` before trusting `-A`.
  - **Two stale facts in §2 fixed while here:** it claimed migrations "through `00022`" when `00024_upload_session_taken_at` exists.

- `fix/mobile-tab-landing-routes` (2026-08-12) — **Two tabs opened a detail screen instead of their list, because a tab trigger names a group and the group's Stack picks its own root by filename length.**
  - **`NativeTabs.Trigger name="(search)"` points at the group, not at a screen.** With no `initialRouteName`, which route becomes the stack root is decided by expo-router's own `sortRoutes`, and its last tiebreaker is filename **length**. `(search)` held `search.tsx` and `tag.tsx`, so the shorter `tag` won: pressing Search opened the tag grid with no `tag` param — the header read "Tag" over a spinner that never resolved, because `TagGrid` bails out of its fetch without clearing its initial `loading`. `(albums)` had the identical shape (`albums.tsx` vs `album.tsx`) and landed on album detail with no `id`; that one only *looked* fine because `album.tsx` redirects when `id` is missing, so the tab worked by bouncing off a guard written for hand-typed links. Verified against `sortRoutes` directly: `['search','tag'] → tag`, `['albums','album'] → album`, and `['index',…] → index` in both cases.
  - **The fix is `index.tsx`, and the test is the interesting part.** `navigation.test.ts` imports **expo-router's own comparator** rather than re-implementing the sort, so it asserts what the router will actually do. It reads the route names off the filesystem, **including subdirectories** — `sortRoutes` treats a *group* route as index-equivalent (`route === 'index' || matchGroupName(route) != null`) and then falls back to length, so a nested `(x)/` would take the root back from `index` and a five-character group would tie and fall to readdir order. A test that only looked at `.tsx` files would be blind to the one thing that can still break this.
  - **`index` is therefore not an unconditional guarantee.** If any tab group ever needs a nested group directory, declare the root with `unstable_settings.initialRouteName` — `sortRoutesWithInitial` matches the name before any group or length comparison. The filename convention is enough only while every route in a group is a plain file, which is what the test enforces.
  - **Four detail routes gained missing-param redirects** (`(gallery)/tag`, `(gallery)/place`, `(search)/tag`, and `(albums)/album` already had one). Restored navigation state can land on any of them without its query param, and each would otherwise sit on a spinner forever. In `place.tsx` the guard sits **below** the hooks deliberately — returning before the `useState` calls would make hook order conditional, and the effects above already no-op without a city.
  - **Verification ceiling, unchanged.** `make check`, `tsc --noEmit`, `expo lint`, 188 vitest tests, `check-tokens`. **Nothing rendered** — but note that this claim is now stale in a way worth acting on: Xcode and eight iOS simulators (iPhone 17 Pro through iPad mini) *are* available on the current dev machine. Every "there is no simulator here" line in the entries below was true when written and is not true now.
- `feat/mobile-web-albums-and-pagination` (2026-08-02, fifth pass) — **Four list endpoints returned a cursor they ignored. Album membership writes were unbounded and untransacted. Tags had no web UI at all. Nothing device-verified.**
  - **The pagination bug is the one to remember.** `getAlbum`, `listFavorites`, `listTrash` and `onThisDay` each computed a `next_cursor` from the last row and sent it, then never put it in the WHERE clause — only `/search` and `/assets` (via `respondFiltered`) did. Following the cursor re-served page one. Mobile *does* page Trash and On-this-day and appends each response, so scrolling produced an endless run of duplicate rows with duplicate React keys; every other surface silently stopped at one page. `cursorPredicate` is now shared and lives beside `encodeCursor`, because it has to stay in step with `assetSelectSQLWithJoin`'s ORDER BY or paging skips or repeats rows. `pagination_test.go` walks each endpoint to exhaustion and asserts the pages are disjoint and complete; it was confirmed to fail against the old code (`page 1 re-served asset …`).
  - **Two fixture traps in that test, both worth knowing.** Identical JPEGs are deduplicated by the importer's BLAKE3 hash, so seven copies of one image import as *one* asset and every pagination assertion passes vacuously — `writeDistinctJPEG` varies the pixels and the seed asserts `Imported == n`. And Trash needs `deleted_at NOT NULL`, which excludes those same rows from favorites/memories/album, so each case gets its own library rather than one shared fixture.
  - **The owner-scope guard was extended, deliberately.** Appending the cursor made four WHERE clauses non-literal and the guard rejected them. Allowlisting the four would have *stopped* verifying them, so instead `checkAssetSelectCall` now falls back to `staticParts` — the same joined-static-fragments judgement its inline-SQL branch already used — and the owner predicate stays visible to the guard. Two safeguards: the allowlist is consulted **first** (an earlier ordering broke `listAssets`/`respondFiltered`, whose static text is a bare `"WHERE "`), and the fallback applies only to concatenations, so a WHERE hidden behind a variable still fails. Verified it still bites by deleting an `owner_id` predicate.
  - **Album membership writes: capped and transacted.** Both endpoints looped `d.DB.ExecContext` per asset, so every row was its own implicit transaction and each linked row wrote `change_log` in a second — 500 photos meant ~1000 WAL commits for one user action, and a mid-way failure left the album holding an arbitrary prefix. Now one transaction with prepared statements, and the same `maxBatchIDs` ceiling `/assets/batch` and `/assets/zip` already enforced. This became urgent because the clients grew Select all and an add-photos picker in the same pass.
  - **Adding photos *from inside* an album was missing on both clients.** The only direction was select-in-gallery-then-pick-a-target, which is no help when you are looking at the album. Both pickers mark what the album already holds as ticked and unselectable, and report the server's `added` count rather than `ids.length`, because `INSERT OR IGNORE` means re-picking is a successful no-op. Mobile's `removeFromAlbum` had existed in `library-api.ts` and been **called from nowhere** since it was written; it is now the album selection bar's "Remove", worded and placed apart from "Trash" because unlinking leaves the photo in the library.
  - **`selectionMode` is now separate from "the set is non-empty"** on PhotoGrid. That inference was what blocked a Select button: pressing Select and choosing nothing yet left a tap opening the viewer.
  - **Web had no tag UI whatsoever.** `api.tags/createTag/assetTags/setAssetTags` had been in `api.ts` since R2 and were called from zero components — tagging was mobile-only. Now `/tags`, `/tags/[id]` and a Tags section in the Viewer. Also on web: timeline grouping (day/month/year/off), a scroll scrubber, and a real bug in `labelDate` — it parsed `taken_day` as UTC midnight then formatted in local time, so every photo taken on the 1st headlined the previous month for anyone west of Greenwich.
  - **`Stack.Toolbar`, not `headerRight`.** An `@expo/ui` Host in `headerRight` is an arbitrary custom view to the navigation bar, and iOS 26 wraps those in its shared glass background — the large white disc in the Gallery corner. Shrinking the host only shrank the icon inside the same disc. Toolbar items are real bar button items, sized and placed by the system, and `hidesSharedBackground` opts out of the glass. `headerRight`/`HeaderButton` were removed outright so the path back to the bug is closed.
  - **Android icons are the defect this pass nearly shipped.** expo-router's own types say Android renders only image sources on toolbar items — "SF Symbols and xcasset icons are silently dropped" — so all four migrated controls would have rendered empty on Android, and a clean `expo export` proves nothing about it. `toolbarGlyph()` branches: SF Symbol on iOS, a short text label on Android. Passing both was rejected because the docs say an icon suppresses the label, which is not checkable from here.
  - **Verification ceiling, unchanged and worth repeating.** `make check`, `make check-gen`, web `svelte-check` + `build`, mobile `tsc`/`expo lint`/150 vitest tests/`check-tokens`, and clean `expo export` for **both** iOS and Android. That proves routes resolve and modules evaluate. **Nothing here has been rendered** — no simulator or device exists in this environment. The header treatment in particular has been wrong twice (large-title inset, then the glass disc), and `expo-linear-gradient` is a new native dependency, so the scrim needs a dev-client rebuild before it appears at all. Web still has **no unit test infrastructure**, so `groupAssets`, `labelGroup` and the timezone fix are uncovered.

- `feat/mobile-common-header-and-viewer` (2026-08-02, third pass) — **One header definition for the whole app, per-tab stacks, the large-title overlap bug, and a photo viewer that finally shows an asset's metadata. Nothing device-verified.**
  - **The reported bug and the real bug were the same bug, in six places.** The screenshot showed "Settings" drawn on top of the library stats card. Cause: `settings/index.tsx` wrapped its `ScrollView` in a `ThemedView`. `headerLargeTitle` makes UIKit **overlay** the navigation bar and rely on the screen's *first-descendant* scroll view to carry the content inset; behind a wrapper view, react-native-screens finds nothing to inset, so `contentInsetAdjustmentBehavior="automatic"` was already set and did nothing. All six settings pages had the wrapper. **The generalisable rule: a large title is a contract with the scroll view, not a style.** `headerOptions({ large })` therefore defaults to **false** and is opted into only where the scroll view really is the screen's root — the photo surfaces put their grid behind banners and error states, so they take the compact title and depend on nothing.
  - **There were seven hand-rolled header bars**, in three type sizes with three different back treatments, none collapsing, none blurring, each re-deriving `insets.top`. All gone. `components/screen-header.tsx` returns *navigation options*, not JSX, because the header worth having is the platform's — that is where collapse-on-scroll, the blur, the system back button and the interactive back gesture come from.
  - **`NativeTabs` draws no header, so every tab needed a Stack.** Tabs now point at route groups — `(app)/(gallery)/`, `(app)/(albums)/`, `(app)/(search)/` — and the parentheses keep every URL where it was (verified against the regenerated `.expo/types/router.d.ts`). Consequences worth knowing: `place`/`tag` push **inside** the Gallery tab instead of covering it; `trash`/`duplicates` moved out of the router root into the Settings stack, so they keep the tab bar and get a real back button; and **a tab stack can only push its own routes** — Search needs its own copy of the tag route (`(search)/tag.tsx`) or tapping a tag there would throw the user into the Gallery tab. Both copies render the shared `components/tag-grid.tsx`. The root redirect target is now `/(app)/(gallery)`, not `/(app)`.
  - **The root `ThemeProvider` was feeding react-navigation stock `DefaultTheme`/`DarkTheme`.** Every surface the OS draws — native headers, the background behind a push transition, the tab bar — reads its colours from there, so all of it was plain `#fff`/`#000` while the app painted warm paper everywhere else. That is *why* native chrome never matched, and why each screen had been painting over it by hand. The theme is now built from the Kuraki tokens.
  - **The viewer's top bar was a single flex row of four text pills** — `Close`, the filename at `flex: 1`, `♡ Favorite`, `⊕ Tags` — so the filename was always the thing that lost, truncating to "Screensh…" between two buttons that kept full width. It was also permanently on screen over the photograph. Now a tap toggles everything: two corner icons (positioned off real insets, not the old hardcoded `top: 48`) and a `@gorhom/bottom-sheet` carrying filename, capture date, size, media type, place and tags — **none of which the viewer previously showed anywhere**. Tags are keyed on the asset **id**, not the asset object, or every favourite tap would refetch them.
  - **Album detail was never navigation.** `AlbumList` swapped `AlbumDetail` in via local state, which looks like a push and is not: no back button, no back gesture, and Android's hardware back left the tab instead of closing the album. It is now `(app)/(albums)/album.tsx`, a real route.
  - **Smaller things found by reading rather than by tooling:** `album-picker` and `pair-scanner` render inside full-screen `Modal`s with no header, so their titles sat under the Dynamic Island and `pair-scanner`'s overlay was pinned to a hardcoded `bottom: 40` (on the home indicator); the four `(setup)` steps centred their content in a plain `View`, so with the keyboard up the pair-code field was behind it with nothing to scroll — now `components/setup-step.tsx` plus a `KeyboardAvoidingView` in the setup layout.
  - **Still open, deliberately:** `selection-bar.tsx` and `trash-selection-bar.tsx` are near-duplicates floating above a hardcoded `BottomTabInset` (50/80) instead of real insets. It is a behaviour change to selection mode rather than header/viewer work, so it was left out of this branch.
  - **Verification ceiling, unchanged and worth repeating.** `tsc --noEmit`, `expo lint`, 135 vitest tests, `check-tokens`, `make check`, and a clean `expo export` — which proves routes resolve and modules evaluate, **and nothing about how any of it looks**. There is no simulator here. The large-title/scroll-view contract above is the specific thing to check first on hardware.

- `feat/mobile-nav-redesign` (2026-08-02, second pass) — **Native tab bar, settings tree, preference store, notifications. Four UI defects fixed. Nothing device-verified.**
  - **The custom tab bar was deleted, and that is the lesson.** iOS 26 already ships this design: `NativeTabs` takes `minimizeBehavior="onScrollDown"` for the collapse-to-pill, and a trigger with `role="search"` is rendered by the system as the separate circular button. About 200 lines of `app-tab-bar` + `scroll-reporter` + a hand-written collapse state machine were an approximation of a control the OS provides. **Check the native API before building a lookalike.** Screens now use `contentInsetAdjustmentBehavior="automatic"` rather than manual `TAB_BAR_HEIGHT` padding.
  - **`/api/stats` needed no server change.** It already sits in the router's *"reachable by BOTH principals"* group and resolves its owner through `ownerID(r)`, so a device token reads its own totals. The planned "one-line device mount" would have been a duplicate route for a handler that already works. `internal/httpapi/stats_device_test.go` pins this — including that device and session return identical stats — so the route cannot drift into the session-only group unnoticed.
  - **Four defects, each with a real cause.** Typography: `title` was 48pt and `subtitle` 32pt, a desktop scale, now 28/20. Duplicate headings on Settings and Albums (two components each rendering a title). Everything grouping as **"Undated"**: the SQLite mirror stored `taken_at` but never `taken_day` (cache migration v5). A wall of deprecation text inside the Backup card: the media-library functions re-exported from the package root `console.warn` on every call and are documented as **"will throw in runtime"** — now imported from `expo-media-library/legacy`, Expo's own documented target. Migrating to the new class-based API rewrites the backup scan path and needs a device, so it is deliberately still open.
  - **Settings is a Stack**: `(app)/settings/` with an index (library stats) plus `backup`, `connection`, `activity`, `notifications`, `grid`. Native headers are switched on for this tree only — everywhere else draws its own headerless bar. `components/settings-ui.tsx` holds the shared section/row/switch vocabulary. `BackupPanel` is gone; its manual single-photo upload moved to the Backup page rather than being lost with it.
  - **`lib/prefs.ts` is the one preference store**, and `mergePrefs` is pure and **total** — corrupt or newer-version data degrades to defaults instead of breaking launch. The backup media-type switches are real: the scan passed a hardcoded `['photo','video']`, and `mediaTypesFor` short-circuits when both are off, because an **empty** `mediaType` matches everything and would back up exactly what was switched off.
  - **The tile badge shipped as file size, not backup state.** `loadBackedUpIds()` returns local camera-roll ids while the grid renders server assets — and everything in that grid is backed up by definition, so a backup-state badge would show one value on every tile. `size_bytes` was already in the contract (cache migration v6).
  - **Notifications work on both platforms, and cannot break a binary that lacks them.** `expo-notifications` is required through `loadOptionalModule`, so Expo Go degrades to notifications not firing rather than throwing during module evaluation — the exact failure MapLibre caused on the Library route. Android needs a channel before the first post (API 26+) and `POST_NOTIFICATIONS` at runtime (API 33+); the permission is requested **from the settings screen, never from a headless wake**, where Android has no Activity to attach the dialog to. iOS needs the foreground handler or it silently suppresses notifications posted while the app is open. **Receiving one still requires a dev/release build.**
  - **Verification ceiling, unchanged.** `tsc`, `expo lint`, 132 vitest tests, `check-tokens`, `make check`, plus clean `expo export` bundles for **both** iOS and Android — which proves routes resolve, modules evaluate, and the guarded requires stay deferred. **It proves nothing about appearance.** No simulator exists in this environment; `minimizeBehavior` needs iOS 26 hardware to see at all, and the scrubber thresholds in `lib/scrubber.ts` and grid defaults are expected to need tuning by feel.

- `feat/mobile-nav-redesign` (2026-08-01) — **Split tab bar, search moved to its own route, Backup folded into Settings, device tokens no longer rendered. Stacked on `fix/mobile-pairing-and-map`. Nothing device-verified.**
  - **The iOS UI had no safe-area handling at all.** `react-native-safe-area-context` was a dependency the app never imported once. `NativeTabs` was silently supplying the bottom inset; nothing ever supplied the top, so the library segment row rendered under the Dynamic Island with its labels clipped. Replacing the native bar made both insets ours: `SafeAreaProvider` is now in the root layout, screens pad by `insets.top`, and grids pad by `TAB_BAR_HEIGHT + insets.bottom` so the last row clears the floating bar.
  - **Routes were restructured**, which is the part most likely to trip up later work: `(app)/library.tsx` → `(app)/index.tsx` (Gallery), `(app)/explore.tsx` → `(app)/settings.tsx`, new `(app)/albums.tsx` and `(app)/search.tsx`. The old Backup screen at `(app)/index.tsx` was **not deleted** — it is `components/backup-panel.tsx`, now a section of Settings. `app-tabs.tsx` and its orphaned `.web` variant are gone. `search`, `place` and `tag` are registered with `href: null` so they are navigable but never drawn as tab items.
  - **Decision logic is pure and tested; the rendering is not tested at all.** `lib/tab-bar.ts` (collapse state machine), `lib/search.ts` (chip → `LibraryFilters`), `lib/connection-view.ts` (what the connection section shows). 95 vitest tests pass. That is the honest boundary: every layout, animation and gesture in this change is unverified.
  - **The token rule is an invariant, not just UI code.** `connectionView` checks `hasToken` before anything else, so it can never return `unpaired` for a paired device, and `showsCodeInput` is true only for `unpaired` — the single gate on a code field. Settings reads the stored token solely to derive a boolean and to make requests; it is never bound to a rendered component. `PairSheet` is the only place a pairing secret can be entered, and it only accepts input, never displays one.
  - **Verification ceiling.** `tsc`, `expo lint`, vitest and `check-tokens` all pass, and a full `npx expo export` bundles cleanly — which proves every route resolves and no module throws while evaluating (the failure mode that produced the "missing default export" bug in the previous branch). **It proves nothing about how any of it looks or feels.** In particular the auto-collapse thresholds in `lib/tab-bar.ts` (`COLLAPSE_THRESHOLD` 12, `EXPAND_THRESHOLD` 8, `IDLE_MS` 150) are guesses and should be expected to need tuning on hardware. There is no simulator in this development environment.

- `fix/mobile-android-parity-background-sync` (2026-07-30) — **The Android app did not launch. Background sync was upload-only and unregistered on cold launch. Both fixed; cosmetic parity deliberately deferred.**
  - **Read this before trusting any "verified" claim about mobile.** Every defect below survived `tsc`, `expo lint`, `vitest` and CI, because none of those can see a screen or a device. The two launch blockers were found by reading the code against the platform docs, not by tooling.
  - **Android launch blocker #1 — `Image.configureCache()`.** Called unguarded at **module scope** in `src/app/_layout.tsx`. It is `@platform ios`; `expo-image` has no Android implementation (there is no `configureCache` anywhere under `node_modules/expo-image/android/`, only `ios/ImageModule.swift`). It therefore threw while the root layout module was still evaluating — i.e. every Android launch died before any UI rendered. Now `Platform.OS === 'ios'`-guarded. Android's cache falls back to Glide's defaults; the documented 512 MB cap is iOS-only and the comment now says so.
  - **Android launch blocker #2 — cleartext HTTP.** `normalizeServerURL` defaults a bare host to `http://` + `:3000` and onboarding suggests `192.168.1.40`, but Android blocks cleartext at `targetSdk>=28`. iOS gets `NSAllowsArbitraryLoads` from Expo's default template; Android had nothing, because `expo-build-properties` was not a dependency. Added with `android.usesCleartextTraffic: true`. **The trap: debug and dev-client builds inject cleartext automatically, so a dev-client device pass will pass and prove nothing.** Only an `eas build --profile preview` (or production) can verify this.
  - **Background sync was registered as a side effect of one tap.** `enableBackgroundBackup()` was called only from the Backup screen's switch handler. `_layout.tsx` merely *imported* the module, which defines the task without scheduling it. So anything that dropped the OS registration without going back through that handler — reinstall, restore to a new device, an OS that discarded the task, or a user who never revisited the screen — left `auto` persisted `true` while nothing ran, forever, with no indication. `reconcileBackgroundBackup()` now runs at launch and makes registration match the saved preference. The Backup screen also asks the OS for the real state on mount instead of leaving the note blank until tapped.
  - **The task ran upload only.** Its body was one `backupEngine.run()`. Server→client delta sync and the offline mutation-queue drain fired **only** from `library.tsx`, on mount and `AppState 'active'` — so a user parked on the Backup or Settings tab never received web-UI edits, and an offline favourite sat in `pending_mutations` until they happened to trigger a reconnect. New `background-sync.ts` drains both, and runs **before** backup: backup can consume the whole OS window on a large library, so ordering it first would starve sync indefinitely.
  - **Two silent platform traps in the background path.** (a) `ensurePermission()` called `requestPermissionsAsync()` on every run including headless wakes; Android needs a current Activity to attach that dialog to and a WorkManager wake has none, so it failed with no user-visible reason. Headless runs now use `getPermissionsAsync()` and defer asking to the next foreground run. (b) `SecureStore` used the default `WHEN_UNLOCKED`, so the task could not read the device token while the phone was locked — **exactly when iOS schedules it** (idle and charging). Now `AFTER_FIRST_UNLOCK`, with a one-off launch rewrite because a keychain item keeps the accessibility it was created with, so existing installs would otherwise stay broken until re-paired by hand.
  - **Uploads now resume mid-file.** The session id was never persisted, so `capture-api.ts`'s `let offset = start.received_bytes` was effectively dead code and a 4 GB video killed at 95% restarted at byte 0. The client persists `{sessionId, size, offset}` and skips `captureStart` on resume. **No server change was needed** — `captureAppend` already takes a session id, and the existing 409 + `Upload-Offset` realignment corrects a stale hint, so a wrong offset costs one round trip rather than corrupting the upload. An expired session (404/410) restarts cleanly once.
  - **Wi-Fi-only, defaulting ON.** There was no network check of any kind, so a background wake would push an entire camera roll over cellular. Unknown connection types (VPN, some tethering) are **allowed**, not refused: silently stopping backup on a network we merely failed to classify is worse than an occasional unexpected upload.
  - **The uploaded-id set moved to SQLite, in its own database file.** It was a JSON array in AsyncStorage rewritten in full on every successful item; Android caps AsyncStorage at 6 MB with a 2 MB single-row ceiling, and the read sat *outside* the caller's try/catch, so a large library eventually took down `run`/`setAuto`/`subscribe`. **Deliberately not in `kuraki.db`** — that file documents itself as a disposable read cache ("dropping the file is acceptable"), which is true of mirrored server data and emphatically false of a ledger whose loss re-transfers every photo. Legacy ids migrate once, idempotently.
  - **Two Android-only correctness bugs.** The tag sheet's `@gorhom/bottom-sheet` lived inside an RN `Modal`; RNGH's Android root is a *native* view and a Modal is a separate window, so drag and pan-down-to-close were dead on Android while fine on iOS — fixed with a second `GestureHandlerRootView` inside the Modal. And Android's `Alert` ignores `style` entirely and makes the **last** button the emphasized positive one, which made "Delete forever" the default-looking action on an irreversible purge; the buttons are now ordered per platform.
  - **The engine had zero tests.** `background.ts`, `backup-engine.ts`, `backup-store.ts` and `capture-api.ts` were entirely uncovered, and `sync.test.ts` is misleadingly named — it only tests the 4-case `changeAction` switch. Suite is now 65 (was 48). The network policy was **split from the native read** (`network-policy.ts` vs `network.ts`) because `expo-network` drags the RN runtime in and the suite is node-only by design; that split is what makes the metered gate testable at all.
  - **VERIFICATION — and its hard limit.** `tsc`, `expo lint`, vitest (65), `check-tokens`, plus root `make check` and `make check-gen` all green. **Nothing is device-verified. There is no simulator here and these native modules cannot run in Expo Go.** Four passes a human must do: (1) Android launches past the root layout; (2) an Android **preview** build reaches an `http://` LAN server — a dev-client build cannot test this; (3) an Android background wake actually uploads; (4) iOS background backup runs with the phone locked.
  - **Deferred by decision, not forgotten** (§8 has the row): no safe-area handling anywhere in the app (Android is edge-to-edge, so content sits under the status bar), custom-font weight fallbacks, unstyled `Switch`, video always streaming the original instead of the `web_viewable` derivative, unused `RECORD_AUDIO`/`READ_MEDIA_AUDIO` permissions, and EAS profiles that build `.aab` while the server serves `.apk` from `KURAKI_ANDROID_APK`.

- `feat/multi-user-isolation` (2026-07-27) — **Multi-user, isolated-libraries model. Closes the seven deferred owner-scoping surfaces, adds admin-managed accounts, and makes the invariant mechanically enforced. Unparks the §8 multi-user row by explicit human decision; sharing/OIDC stay parked.**
  - **The model.** Isolated libraries: `owner_id` is a hard wall. An admin administers *accounts and server settings*, and has **no path to another user's photos** — isolation is enforced by `owner_id` on every query, never by role. Storage layout is unchanged: originals are already `originals/YYYY/MM/<uuidv7>.ext`, so the flat tree reveals no ownership and invariant #2 (write-once, never moved) is not disturbed.
  - **The seven surfaces (Phase 1), all previously listed as deferred in the unified-auth handoff below.** `stats.go` (5 aggregates + trash/album/places/by-year), `places.go` (both endpoints), `stacks.go` (members *and* the `stack_id` subselect — otherwise another owner's stacked asset leaks through the fallback), `media_health.go` (issue list + `rebuildAsset`), `download.go` `exportLibrary` (was zipping **every original in the database**), the `stack_size` subquery in `assetSelectSQL` (fixed by correlating `s.owner_id = a.owner_id`, so no caller threads a new param), and `patchAsset`'s pre-read. Each has a cross-owner isolation test **verified failing first**.
  - **The centerpiece is the guard test, not the seven fixes.** Owner-scoping was enforced by per-handler discipline and seven handlers forgot; fixing them without changing that dynamic just resets the clock. `ownerscope_guard_test.go` parses `internal/httpapi` and enforces two rules: self-contained SQL touching `assets`/`albums` must carry an `owner_id` predicate, and every `assetSelectSQL`/`assetSelectSQLWithJoin` **call site** must pass a WHERE containing one. Exceptions live in `allowedUnscopedSQL` (keyed `file.go|fragment`) and `allowedDynamicWhere`, each with a stated reason. Scope is `internal/httpapi` only — `internal/app` background workers maintain every owner's data by design.
  - **Two holes were found by probing the guard, not by review.** (1) The allowlist was keyed by SQL text alone, so `stats.go` silently inherited `metrics.go`'s exemption for a byte-identical `COUNT` — now keyed by file too. (2) Halting AST descent at a concatenation meant `assetSelectSQL(...)+" LIMIT ?"` call sites — nearly all of them — were **never checked at all**; descent now continues and fragments are suppressed by marking. Six regression probes are recorded in the commit message; re-run them if you touch the guard. **A guard that cannot fail is not a guard.**
  - **Migration `00023`.** `users.role` (admin|user, existing owner backfilled to admin), `users.disabled_at` (soft disable — revoking access must not destroy a library), and `import_state` **rebuilt** with PK `(owner_id, source_path)`. That last one was a real latent bug: the bare `source_path` PK made resume state global, so a second owner importing the same shared NAS path was silently skipped as "already done" with no error. Legacy NULL `change_log` rows are **attributed to the sole owner, not deleted** — deleting them would move `MIN(id)` and force connected clients into a spurious full resync.
  - **Per-owner sync.** `ChangeBroker` now keys subscribers and high-water marks by owner and polls one `GROUP BY owner_id` query (cost still constant in client count). The delta feed's `OR owner_id IS NULL` is **gone** — exactly as the §11 note below predicted, this self-resolved once every row was owner-attributed, and the planner now gets a clean `(owner_id, id)` range scan instead of a MULTI-INDEX-OR against a temp b-tree.
  - **Accounts.** `requireOwner` (the chokepoint deliberately left for this) became a real admin check. **`/devices` moved OFF it** — `listDevices` is already owner-scoped, so every user manages their own devices; gating it on admin would have been a regression for non-admins. First-run setup now sets `role=admin` **explicitly**, because on a fresh install 00023's backfill never runs and the first user would otherwise default to `user`, leaving nobody able to administer the server. Sessions resolve only for enabled users. `DELETE /users/{id}` refuses with the asset count; `?purge=true` opts in. The last active admin cannot be demoted/disabled/deleted; nobody can delete themselves.
  - **A test that passed for the wrong reason.** `TestDeleteSelfRefused` passed even with the self-delete guard removed — the last-admin guard also returns 409. It now creates a spare admin and asserts the *error code*. Worth remembering when asserting on status alone.
  - **CLI.** `kuraki useradd` / `userlist`, alongside `passwd`. Exercised end-to-end against a real library including the duplicate/invalid-role/short-password rejections.
  - **VERIFICATION.** `make check`, `make check-gen`, web `npm run check` (0 errors) + `build` + `check-contrast.py`, mobile `tsc` + vitest (48) + `check-tokens` — all green. **The web Users pane is NOT browser-verified** (no browser in this environment): the create/promote/disable/purge-confirm flows are logic- and type-verified only and need a human pass.
  - **Still open.** Per-client acked-cursor tracking (the reset fallback keeps it optional). Multi-user `change_log` prune floors are per-owner now, but pruning itself is still global-keep-N. No sharing, no OIDC, no quotas, no per-user storage subtrees — all deliberately out of scope.

- `main` branch integration (2026-07-27) — **Audited and merged every outstanding branch.**
  - Merged `feat/immich-migration`, `fix/mobile-responsive`, and
    `feat/settings-consolidation` on top of the local landing-page commit already on `main`.
  - Preserved Immich's documented schema as `00021_migrations.sql` and renumbered the independent
    settings migration to `00022_settings.sql`; Goose now has one file per version.
  - Rebuilt the embedded SvelteKit output from the combined responsive + Settings sources instead
    of choosing either branch's stale timestamp-hashed bundle.
  - Integration verification found two cross-branch compile failures that isolated branch tests
    could not: `App.Migrate` still read the removed `a.Cfg`, and both migration CLI commands called
    the old four-argument `app.New`. They now use `Settings.Booted()` and pass `os.Getenv`.
  - Verified the final merged tree with `make check`, `make check-gen`, web `svelte-check` + build,
    mobile `tsc` + Expo lint + 48 Vitest tests, and pure-Go cross-compiles for linux/amd64,
    linux/arm64, darwin/arm64, and windows/amd64.
  - Browser smoke at 390×844: Timeline `document.scrollWidth === clientWidth === 390`, header
    scroll width stayed within its 358px box; Settings Overview/Server rendered, a restart-required
    numeric setting saved and returned feedback, `/stats` redirected to `/settings`, the public APK
    path was absent from the writable catalog, and no console warning/error was emitted.

- `feat/immich-migration` (2026-07-26) — **Migrate a whole library in from Immich, metadata intact.**
  - **New packages.** `internal/migrate` is a source-agnostic engine: a `Source` only enumerates
    items, describes them, and streams bytes; batching, resume, album/tag/stack wiring and trash
    handling live in the engine. `internal/migrate/immich` implements it over Immich's REST API
    (`x-api-key`, read-only). A Google Takeout `Source` slots in here later with no engine change.
  - **Importer seam.** `takeout.NewResolver()` was hard-wired inside `importer.Run`; it is now
    `Options.Metadata importer.MetadataProvider`, defaulting to that same resolver when nil, so every
    existing caller is byte-for-byte unchanged. `insertAsset` learned `rating`/`archived`/`hidden`
    (previously left at DB defaults), and `Result.Assets` now reports the asset each source file
    became — **including duplicates**, whose id `assetExists` already computed and threw away. Without
    that, a re-run could not file an already-present photo into its album.
  - **Schema 00021.** `migration_runs` + `migration_map`, the source-id↔local-id mapping the repo had
    nowhere. Keyed `(owner, source, kind, source_id)` — not by run — which is what makes re-runs
    idempotent and resume cheap. Plus `albums.description` (Immich has one, Kuraki didn't) and
    `assets.stack_locked`.
  - **`stack_locked` is not incidental.** `stacks.Detect` wipes and recomputes *every* stack from
    filename heuristics after each import, so the first upload after a migration would have silently
    dissolved every stack Immich had stated explicitly. Detection now skips locked rows.
    Test: `TestMigratedStacksSurviveStackDetection`.
  - **Three defects only a live server exposed** (fake-source unit tests passed throughout):
    1. `withStacked:false` makes Immich omit **every member of a stack, primary included** — not just
       children. Any search without it silently drops those assets from the migration. It is now
       unconditional in every search body, independent of `--stacks`. Regression test:
       `TestEverySearchRequestsStackedAssets`.
    2. `POST /search/metadata` does **not** hydrate `tags` or `stack` (only `GET /assets/{id}` does).
       Both are now inverted from list endpoints — `GET /stacks`, and one filtered search per tag —
       which is O(tags+1) requests instead of O(assets).
    3. Album membership is likewise per-album, not on the asset payload.
  - **Credentials are deliberately not persisted.** Migration jobs appear in the Activity view and
    report live progress, but the worker never runs them; on restart, crash recovery fails an
    orphaned migration with the exact `--resume` command instead of requeueing it into the importer.
  - Verified against a real **Immich v3.0.3** in Docker seeded with albums, nested tags, a stack,
    favorites, ratings, archived/hidden/trashed assets and GPS: 7/7 imported, 0 errors; re-run
    imported 0 and duplicated nothing; `kuraki verify` clean. `make check` green.

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
  - **[RESOLVED 2026-07-27 by `feat/multi-user-isolation` — all seven closed + a guard test added; kept for history.] DEFERRED owner-scoping — harmless in single-owner, MUST be closed before multi-user unparks (§8 "Sharing & multi-user"):** aggregate/admin reads still query all owners — `stats.go` (COUNT aggregates), `places.go` (place aggregation), `stacks.go` (`GET /assets/{id}/stack` per-id stack view), `media_health.go` (rebuild existence check), `download.go` `exportLibrary` (session-only whole-library export), the `stack_size` count subquery in `assetSelectSQL`, and `patchAsset`'s internal pre-read at edit.go:46 (the UPDATE is scoped, so no response leak). None are exploitable with one owner; all leak cross-owner data or counts the moment a second owner exists. Grep `FROM assets`/`UPDATE assets` in `internal/httpapi` and scope each when multi-user lands.
  - **[RESOLVED 2026-07-27: change_log pruning is per-owner-floored, the broker is owner-scoped, the `OR owner_id IS NULL` clause is gone, and account creation exists. Acked-cursor tracking remains open.] Also still owed at multi-user (from earlier handoffs, unchanged):** `change_log` pruning + per-client acked-cursor tracking; the SSE `ChangeBroker` broadcasts a global high-water mark (scope by `owner_id` then); actual multi-user account creation (parked by decision). The delta-sync feed's `OR owner_id IS NULL` clause self-resolves at that point.
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
  - **[RESOLVED 2026-07-27: the clause is dropped and the planner now gets the clean `(owner_id, id)` range scan this note predicted. Migration 00023 attributed the last NULL rows first.] Phase-1 `owner_id IS NULL` clause — read before touching the feed query.** The query is `WHERE id > ? AND (owner_id = ? OR owner_id IS NULL) ORDER BY id ASC LIMIT ?`. The `OR owner_id IS NULL` exists because a purged asset's `assets` row is gone by the time some historical rows were written/backfilled, so a null owner is treated as visible to the sole Phase-1 owner rather than silently dropped. **This makes the query plan a MULTI-INDEX-OR against a temp b-tree** (SQLite can't satisfy an OR-of-columns with the single `(owner_id, id)` index the way it could satisfy `owner_id = ?` alone) — checked with `EXPLAIN QUERY PLAN`, acceptable at current `change_log` volumes but worth re-profiling once the table is large. It **self-resolves**: once multi-user unparks (§8 "Sharing & multi-user", currently parked by decision) and every row is confirmed owner-backfilled, drop the `OR owner_id IS NULL` clause and the planner falls straight into a clean `(owner_id, id)` range scan on the existing index. Don't try to "optimize" this before then — the NULL branch is load-bearing for the purged-asset case, not dead code.
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
