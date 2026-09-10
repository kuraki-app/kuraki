# Changelog

All notable changes to Kuraki are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning moves to
[Semantic Versioning](https://semver.org/) once the first tagged release lands.

Each entry describes **what was added, changed, or fixed** in plain terms. Add a
line under `Unreleased` as part of the same change that introduces it.

## [Unreleased]

### Changed

- **Mobile web now matches the app's primary structure.** Phone widths use Gallery, Albums,
  Settings, and Search tabs, a three-column default photo grid, search controls only when requested,
  and an always-visible grouped Settings page instead of an eight-control rail or collapsible
  dashboard. Account, Photos, Server, and Advanced sections keep related destinations together;
  phone widths show only a compact server summary while detailed health charts remain on desktop.
- **Mobile Settings now keeps common preferences one tap away.** Notifications and Photo Grid moved
  to the main page, while Activity moved under Advanced. The server summary no longer repeats the
  total beside its media counts or includes the trash count; it shows only the useful breakdown,
  stored size, address, and connection state.
- **Local development now runs directly on the host.** `make dev` / `scripts/dev.sh` remains the
  hot-reload path, `scripts/start.sh` runs the complete app from source, and Docker is reserved for
  published-image verification and production deployment. The root Compose file no longer builds
  the working tree, and the obsolete local Docker development helper was removed. `make clean` now
  removes all disposable build/test output while preserving installed JavaScript dependencies and
  library data.
- **Kuraki's default port is now `39170`, not `3000`.** 3000 is the most contested port on a
  developer's machine, and losing that race is not loud: a container on this project's own machine
  published a port it never actually held, for 22 hours, while reporting healthy. Every port Kuraki
  binds is now declared once in `internal/config/ports.go` and generated outward — `39170` for the
  server, `39175`/`39176` for the hot-reload API and web UI, `39177` for Metro (Expo's 8081 collides
  with any other React Native project), `39178` for the browser suite. They differ from each other on
  purpose, so a container, a dev session, a bundler and the e2e run can all be up at once. Existing
  installs keep working by setting `KURAKI_ADDR=:3000`; a phone that stored a `:3000` address keeps
  using it, since a stated port is always respected.

### Added

- **The web client is installable as a PWA.** Its service worker keeps the application shell
  available offline without caching authenticated API/media responses. User-selected photo and
  video uploads are stored per account in IndexedDB, one file at a time, and resume on reconnect or
  reopen; browsers with Background Sync can continue the queue after the page closes.
- `KURAKI_PUBLIC_URL` — the address other devices should use to reach this server. The pairing screen
  previously derived candidates from the machine's own network interfaces, which is right for a
  bare-metal install and impossible in a container or behind a reverse proxy.
- **[USER_GUIDE.md](./USER_GUIDE.md)** — what Kuraki does, described as flows: what each one asks of
  you, what the server does with it, what comes back, and how it fails. No code, no installation
  detail, nothing about how a screen looks. Also a shorter "How Kuraki works" page on the docs site.

### Fixed

- **The mobile library can now recover stale or blank thumbnails with Retry or pull-to-refresh.**
  Both re-probe the server and reload the active Timeline, Memories, or Archive view, while stable
  image recycling keys prevent virtualized cells from retaining another asset's failed image state.
- **The host development launcher now starts under strict Bash mode.** Unicode punctuation directly
  after two unbraced port variables was parsed as part of each variable name on this machine, so
  `make dev` exited before starting Go or Vite. The variables are now explicitly braced.
- **A transient database error unpaired every phone.** `resolveDevice` gave the same answer for "no
  such device" and for "the lookup failed", and both became `401` — which is the client's
  instruction to delete its credential, because that is what a revoked device means. So a momentary
  fault permanently unpaired every paired phone, each needing a human to re-pair it. Observed: a
  156ms burst of `database disk image is malformed` produced 19 of these and a phone that had paired
  seconds earlier deleted its token. A lookup that cannot run now answers `503`, which clients
  already retry without touching what they have stored; a token no device owns still answers `401`.
- Two client-side halves of the same problem: a 401 for a request that carried **no** token raised
  "This device was disconnected" at someone who had never paired (screens fetch during onboarding,
  before pairing), and a 401 already in flight when the user paired deleted the credential pairing
  had just written. Auth loss is now attributed to the token that actually failed.
- **The mobile app could not be pointed at a server on the internet.** Any address typed without a
  scheme became `http://<host>:3000`, so the reverse-proxy deployment in DEPLOYMENT.md — a domain on
  443 — was unreachable, and on iOS it was refused outright rather than merely failing (App
  Transport Security permits cleartext on the local network only). A domain is now tried over HTTPS
  first and a LAN address over HTTP on the server's own port, and whichever answers is the one kept.
- **Pointing the app at a different server kept showing the previous library.** The offline mirror
  and the delta-sync cursor were keyed by nothing, so the new server was asked for changes since a
  position in the *old* server's change log — it had nothing newer to report, and the app settled on
  another library's photos while reporting "Connected". Changing the server, or pairing as a
  different account, now clears the mirror.
- A malformed server address in mobile Settings raised an unhandled promise rejection instead of an
  error, and the status line went on claiming the old address was connected. The status line also
  followed the text field while it was being edited, so half-typed input read back as a connection.
- iOS builds declared no `NSLocalNetworkUsageDescription`, which iOS 14+ requires to reach a server
  on the local network. It — and the App Transport Security posture — now come from `app.json`
  rather than from an untracked `ios/` directory.
- The hint under the mobile server-address field called a half-typed IPv4 address a public domain and
  offered HTTPS — it only recognised a complete dotted quad, so someone typing a LAN address read the
  wrong advice for as long as they were typing.
- **`kuraki backup` destroyed its own run when the archive was written into the library.**
  `kuraki backup /data/x.tar.gz --data-dir /data` archived the file it was writing: the walk reached
  an archive that grew with every byte added to it, and the run died on `archive/tar: write too
  long` after inflating past the size of the library — leaving a truncated, unrestorable `.tar.gz`
  sitting exactly where a real backup belongs. The destination is now excluded from the walk, and a
  failed backup deletes its partial archive instead of leaving something that looks like one.
- **`make dev` could not complete first-run setup.** The server refuses browser cross-origin state
  changes by comparing Origin against Host, and Vite rewrote Host to the proxy target — so every
  POST, PATCH and DELETE came back 403 `cross_origin_request` while reads worked normally, making
  the UI look healthy until the first write. The dev proxy now preserves the browser's Host.
- `scripts/start.sh --addr :4000` announced `http://localhost:3000` regardless of the address given.
- Development libraries created with `--data-dir ./kuraki-data-dev`, as the runbook suggests, were
  not gitignored; the pattern now covers them.
- `make dev` did not proxy `/download`, so the Devices page's Android APK link 404'd in dev; and the
  API port was hardcoded in both `scripts/dev.sh` and `web/vite.config.ts`, so moving one left the
  other pointing at whatever else held 3000. The port is now `KURAKI_PORT`, chosen once and
  exported, `dev.sh` refuses to start when it is busy (naming the process holding it), and a test
  fails the build if the proxy list drifts from the router.
- **Saving a search broke the saved-search list.** `GET /api/saved-searches` returned 500 from the
  moment the first search existed, because the stored query could not be scanned back out of SQLite.
  The web UI reported "No saved searches yet" rather than an error, so the feature looked empty.
- **The pairing screen offered an unreachable address in Docker.** A container can see only its own
  bridge interface, and the screen preferred that address over the one the browser was already
  using — dropping the "a phone using this would try to reach itself" warning as it did so. In a
  container the server now offers nothing and the browser's own address stands; set
  `KURAKI_PUBLIC_URL` to state the answer.
- `/api/login` and `/api/setup` returned an empty `role` for the user they signed in, disagreeing
  with `GET /api/me`.
- libvips wrote about ten unstructured lines to stderr per imported image, burying import progress
  and the result line. Its output is now structured, at warning level, and deduplicated.

### Changed

- Documentation reconciled with the shipped code. The README described single-owner auth (multi-user
  with isolated libraries shipped), search that only matched the start of a word (it matches inside
  words now), a change log kept "for future sync" (delta sync, live push and offline reconciliation
  all ship), and Node 20 (the embedded UI is hash-stable only on Node 24). The command table, the
  package map, the generated-artifact rules, and the real list of CI gates are now accurate in the
  README, CONTRIBUTING, and both client READMEs.

## [0.1.0] - 2026-08-12

The first tagged release — a self-hosted photo & video backup with a
Docker-first deployment and a full browser experience over an embedded web UI,
plus an Expo client for iOS and Android.

This release is what makes Kuraki obtainable: before it there was no tag, so no
published image and no downloadable binary. `ghcr.io/kuraki-app/kuraki:latest`
and the archives attached below are new. The mobile apps are **not** in any app
store; they are built from `mobile/` and are not release-certified on physical
hardware.

### Added

**Setup & operations**
- Zero-config server: run it with no config file and it picks a data directory,
  port, and database location, and prompts for an admin account on first visit.
- Admin account creation and login, with argon2id password hashing and
  HttpOnly/SameSite session cookies. Failed logins are rate-limited per IP.
- First-run onboarding: the setup screen now defaults the username to `admin`,
  asks for the password twice (with a live "passwords do not match" check and an
  8-character minimum), and explains it is creating the server's owner account.
- Change your password from the web UI's Settings page (verifies the current
  password and signs out every other browser/device session), and an offline
  `kuraki passwd` command to reset it directly against the library — the recovery
  path when the owner is locked out. Both invalidate existing sessions so a reset
  also revokes any stolen cookie.
- Automatic database snapshot taken before every schema migration, so upgrades
  are safe and reversible.
- Opt-in unattended backups (`KURAKI_BACKUP_DIR`): the server writes a
  SQLite-consistent archive on an interval (`KURAKI_BACKUP_INTERVAL_HOURS`,
  default 24), prunes to the most recent `KURAKI_BACKUP_KEEP` (default 7), and
  records each run. The Library dashboard shows the last backup's age, size, and
  outcome — and flags an overdue or failed one — so a passive user who never runs
  `kuraki backup` by hand still has a recent, visible safety net.
- `/healthz` liveness endpoint (public) and a `/metrics` endpoint reporting
  memory, goroutines, uptime, and library counts. `/metrics` requires an owner
  session or an `Authorization: Bearer <KURAKI_METRICS_TOKEN>` header, so library
  size and storage counters are never exposed to anonymous callers.
- Configurable trash retention and thumbnail size via `KURAKI_TRASH_RETENTION_DAYS`
  and `KURAKI_THUMBNAIL_SIZE`; `KURAKI_SECURE_COOKIES=1` marks the session cookie
  Secure for HTTPS production; `KURAKI_OCR=1` enables the local OCR worker.
- Consolidated owner settings UI with Overview, Account, Appearance, Library,
  Devices, Activity, and Server sections. A live settings store resolves defaults,
  database values, and environment/CLI overrides, reports restart-required
  changes, and keeps security-sensitive Android APK serving environment-only.
- `KURAKI_TRUST_PROXY=1` opts into deriving the client IP from
  `X-Forwarded-For`/`X-Real-IP`. Off by default so a directly-exposed server
  keys rate limits on the real TCP peer and forged headers cannot bypass the
  per-IP login and pairing throttles.
- The Docker image bundles `tesseract` so opt-in OCR works out of the box.
- Docker image with libvips and ffmpeg bundled, a `docker-compose.yml` for
  one-command hosting, a container health check that self-probes via the binary,
  a non-root runtime user, and OCI image labels.
- Production deployment guide (`DEPLOYMENT.md`) with a ready-to-run Caddy
  stack (automatic Let's Encrypt HTTPS, Kuraki reachable only through the proxy)
  and an nginx alternative, spelling out why `KURAKI_TRUST_PROXY` and
  `KURAKI_SECURE_COOKIES` belong on behind TLS and how a misconfigured
  `TRUST_PROXY` weakens the login rate limits.

**Import & backup**
- Command-line bulk import: recursive, with a progress bar, a dry-run mode, and
  resume-on-interrupt so an interrupted import continues without redoing work.
- Content-hash deduplication (BLAKE3): the same file in two places is stored once.
- Originals are written once into a readable `originals/YYYY/MM/` layout, based on
  EXIF capture date, and are never modified after import.
- Watch-folder mode that rescans a directory on an interval and auto-imports new
  files — pairs with folder-sync tools like Syncthing and rsync.
- Browser drag-and-drop upload that runs through the same import pipeline.
- Browser uploads preserve every selected file even when several share a
  filename, instead of overwriting earlier staged files.
- Capture protocol foundation: authenticated web sessions can issue revocable
  device tokens; mobile clients create resumable upload sessions, append by byte
  offset, and queue completed originals through the standard importer. Abandoned
  sessions expire and are swept, at startup and hourly, so never-completed
  uploads do not leak staging directories or rows.
- Added `mobile/`, a shared Expo/React Native iOS and Android client with
  SecureStore-backed device settings, backup receipts, and manual photo upload.
- QR device pairing: the web app's Devices page mints a short-lived, single-use
  code and shows it as a QR; the mobile app scans it to claim its own revocable
  device token, so pairing a phone no longer requires copying a token by hand.
- Per-album backup selection in the mobile client: choose which device albums
  back up (default is the whole library); an item in several selected albums is
  still uploaded once.
- Automatic camera-roll backup in the mobile client: a persisted queue uploads
  every new photo and video, remembers what the server already accepted so a
  restart never re-uploads, retries each chunk with backoff through a network
  drop, and surfaces per-item failures under "Needs attention". It also runs on
  an OS background schedule (`expo-background-task`) so new photos back up while
  the app is closed, and streams each upload one chunk at a time through a
  native file handle so large videos never exhaust memory.
- Uploads are processed by a background import queue: the request returns
  immediately, a worker imports each job with retries and crash recovery, and the
  UI polls progress. A self-refreshing Activity page lists recent import jobs with
  status, progress, and per-file error detail (which files failed and why).
- Immich migration: `kuraki migrate immich` pulls an entire library across over
  Immich's REST API, preserving capture times, locations, camera details,
  captions, favorites, ratings, archive and hidden state, albums (with their
  descriptions), nested tags, stacks, live-photo pairs, and — with
  `--include-trashed` — the trash. Runs in batches so disk use stays bounded on
  a library of any size, reports progress in the Activity view, and records
  every transferred item so a re-run imports nothing twice and an interrupted
  run resumes without re-downloading. Unsupported items (audio, PIN-locked, or
  offline assets) are skipped with a stated reason rather than dropped silently.
  The API key is used for the run only and is never written to the database.
  See MIGRATING.md for what does and does not come across.
- Google Takeout import: reads the JSON sidecars (tolerant of Google's naming
  variants) so capture dates, locations, captions, and favorites survive a
  migration from Google Photos.
- Media admission identifies standard image/video signatures before trusting a
  filename; renamed valid files import correctly while disguised text/document
  files are reported rather than preserved as broken media.
- Portable backups now carry a versioned file-count/byte-count manifest;
  restores validate the archive in a temporary directory before atomically
  replacing an empty destination.
- `kuraki backup` now uses SQLite's online snapshot mechanism, capturing a
  consistent database (including WAL contents) before it archives originals.
- ZIP exports preflight every original and fail explicitly if one is unavailable;
  selected and whole-library downloads are not limited by the normal API timeout.

**Browsing & search**
- One filter language shared by the web timeline, web search, and the mobile app:
  full-text query, date range, media type, camera, favorite, rating, place, album,
  and archive/hidden — served by a single paginated `/api/search`.
- The web timeline gained a filters panel (All / Photos / Videos / Favorites chips
  and a From/To date range) matching the mobile client.
- Mobile Library tab: a recent, searchable, filterable grid of the server library
  (device-authenticated) with an offline cache so it paints instantly on open, and
  a full-screen swipeable viewer (images and in-app video playback).
- The mobile app now detects a revoked or expired device token, clears it, and
  shows a "reconnect this device" prompt instead of raw errors.
- Opt-in local OCR (`KURAKI_OCR=1`, requires the `tesseract` binary): recognises
  text in images so a search finds words inside screenshots and documents. Fully
  local — nothing is uploaded.
- Virtualized, day- and month-grouped timeline that stays smooth on large libraries.
- Full-screen viewer with an EXIF panel, keyboard navigation, and original download.
- Search by filename, date range, media type, and camera model, with prefix
  matching so partial words find results.
- Favorites with a dedicated feed, albums with membership management, and an
  "on this day" memories view.
- Multi-select batch actions (delete, restore, favorite) and a zip export of any
  selected originals.
- A complete browser experience: a navigation shell with timeline, search,
  favorites, albums, on-this-day, trash, and places; multi-select with a batch
  action bar; a lightbox with in-browser video playback and per-item favorite,
  delete, and restore; drag-and-drop upload with a progress indicator; and album
  create/rename/delete with add and remove.
- A library dashboard with totals (photos, videos, favorites, albums, places,
  size) and a per-year breakdown.
- Editing a photo's capture date, location, and caption — re-geocoding on a
  location change — plus batch capture-time shifting to correct camera timezones.

**Accessibility & appearance**
- New wordmark: replaced the placeholder logo with a "Kuraki" wordmark and a
  simple diamond-in-frame mark (a nod to the *namako-kabe* lattice of a kura
  storehouse), used in the sidebar and as the browser favicon.
- Added a self-contained marketing landing page under `site/` (static HTML,
  theme-aware, no external assets) that can be hosted anywhere.
- Rebuilt the web UI on **shadcn-svelte + Tailwind v4**. A single design-token
  palette (the warm "kura" scheme, mapped onto shadcn's `--primary` /
  `--foreground` / … tokens) themes every surface, with Geist / Public Sans
  typography. Shared primitives — Button, Dialog, Input, Card, DropdownMenu, and
  Sonner toasts — come straight from shadcn so behaviour stays consistent.
- Dark mode across the whole UI, driven by `mode-watcher`. It follows the
  operating system by default and can be pinned to Light or Dark from the
  sidebar; the choice persists and is applied before first paint so there is no
  flash of the wrong theme. Every text/background pair meets WCAG AA contrast in
  both themes.
- Extracted the repeated markup into small components — `PageHeader`,
  `StatCard`, `FilterChip`, `SkeletonGrid`, `EmptyState`, `IconButton` — so the
  route files stay short and consistent.
- Keyboard and screen-reader pass on the web UI: a "skip to content" link, a
  visible focus ring on every control, `aria-current` on the active nav item,
  labelled form fields, live-region toasts (Sonner) and upload/import progress,
  Escape-to-close and focus-trapped dialogs (bits-ui), and honouring
  `prefers-reduced-motion`.

**Places**
- A map of geotagged photos (Leaflet + OpenStreetMap) with clustered thumbnails.
- Offline reverse geocoding resolves GPS to city and country names locally, with
  no external calls, and groups photos into a browsable list of places.

**Performance**
- Long-lived cache headers on originals and hashed UI bundles (immutable) and a
  week-long cache on thumbnails, so the timeline scrolls without re-fetching.
- Gzip compression for JSON and UI responses; SQLite cache, memory-mapped I/O,
  and in-memory temp store for faster queries.
- Index on `album_assets(asset_id)` so album membership lookups and the cascade
  that runs when an asset is trashed stay fast as libraries grow, instead of
  scanning the whole join table per asset.
- Expression index on `(archived, hidden, deleted_at, COALESCE(taken_at,
  created_at) DESC, id DESC)` matching how the timeline, search, places, and
  mobile library page and sort. Each page is now an index seek that stops after
  the page size instead of filtering and sorting the whole library into a temp
  B-tree — verified against a 50k-asset library where the sort step disappears
  from the query plan.

**Media**
- Thumbnail generation through libvips (HEIC/AVIF/RAW previews) with a pure-Go
  fallback, driven by a bounded worker pool.
- Video support: upload, ffmpeg-generated poster frames, and in-browser playback
  with HTTP range requests for seeking.
- Media compatibility contract: the importer classifies browser-safe originals,
  uses ffprobe to inspect video codecs, and creates a JPEG/WebP image preview or
  H.264/AAC MP4 playback derivative when the original is not safe for the web.
  If no local decoder/transcoder can make a derivative, the UI keeps the
  original download available, avoids a broken viewer, and reports the issue in
  Activity's Media health section.
- One-click rebuild: `POST /api/assets/:id/rebuild` regenerates an asset's
  derivatives from the stored original and clears resolved media-health issues,
  surfaced as a Rebuild button in Activity.

**Organize**
- Tags and hierarchical tags, per-asset tagging, and tag-aware search.
- Saved searches over date/type/camera/place/rating/favorite state.
- Ratings, plus Archive and Hidden sections to keep the main timeline focused.
- Duplicate review: a perceptual hash (dHash) groups visually identical and
  near-identical copies (re-encodes, light edits, crops) that byte-level dedup
  misses. Review each group and remove extras — nothing is deleted automatically
  ("keep both").
- Stacks: RAW+JPEG and Live/Motion Photo (image+video) captures are grouped by
  shared filename and date, collapsed to one primary in the timeline with the
  rest a click away.

**Migration & recovery**
- Read-only external libraries: register a folder, scan it, and browse its media
  in place without copying originals in.
- Portable library backup and restore (`kuraki backup` / `kuraki restore`), plus a
  whole-library zip export from the browser (`GET /api/export`).
- Scheduled integrity verification: a background weekly re-checksum records a
  "last verified" result, surfaced on the Library dashboard with a "Verify now"
  action.

**Trust & integrity**
- Trash with a 30-day retention window, restore, and an automatic purge that runs
  at startup and daily.
- `kuraki verify` re-checksums every original and reports corruption, missing
  files, and read errors, exiting non-zero when problems are found.

**Project & foundation**
- Filesystem storage and media processing behind interfaces, keeping domain logic
  free of direct I/O and leaving room for an object-storage backend later.
- SQLite (WAL) with full-text search and versioned migrations.
- Schema built for the future: stable UUID keys, an owner on every asset, soft
  deletes, content hashes, and a change log for eventual device sync.
- Cross-platform builds, continuous integration, and open-source project docs
  (README, contributing guide, code of conduct, security policy, issue and PR
  templates).
- `scripts/start.sh` runs the UI and server together as one production-like
  process; `scripts/dev.sh` runs the API and a hot-reloading Vite UI separately
  (Vite proxies the API), also exposed as `make start` / `make dev`.

### Fixed
- Filename search returned nothing for partial words (for example, searching
  "photo" missed "photo3.jpg"); search now matches on prefixes.
- The web timeline no longer overflows sideways on phones: headers and filters
  wrap, batch actions stay visible, the app grid permits its content track to
  shrink, and virtualized section spacers recalculate across the mobile
  breakpoint and rotation.

### Changed
- Positioned as a Docker-first, self-hosted application built around a libvips +
  ffmpeg media pipeline.

[Unreleased]: https://github.com/kuraki-app/kuraki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kuraki-app/kuraki/releases/tag/v0.1.0
