# Changelog

All notable changes to Kuraki are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning moves to
[Semantic Versioning](https://semver.org/) once the first tagged release lands.

Each entry describes **what was added, changed, or fixed** in plain terms. Add a
line under `Unreleased` as part of the same change that introduces it.

## [Unreleased]

The initial development version — a self-hosted photo & video backup with a
Docker-first deployment and a full browser experience over an embedded web UI.

### Added

**Setup & operations**
- Zero-config server: run it with no config file and it picks a data directory,
  port, and database location, and prompts for an admin account on first visit.
- Admin account creation and login, with argon2id password hashing and
  HttpOnly/SameSite session cookies. Failed logins are rate-limited per IP.
- Automatic database snapshot taken before every schema migration, so upgrades
  are safe and reversible.
- `/healthz` liveness endpoint (public) and a `/metrics` endpoint reporting
  memory, goroutines, uptime, and library counts. `/metrics` requires an owner
  session or an `Authorization: Bearer <KURAKI_METRICS_TOKEN>` header, so library
  size and storage counters are never exposed to anonymous callers.
- Configurable trash retention and thumbnail size via `KURAKI_TRASH_RETENTION_DAYS`
  and `KURAKI_THUMBNAIL_SIZE`; `KURAKI_SECURE_COOKIES=1` marks the session cookie
  Secure for HTTPS production; `KURAKI_OCR=1` enables the local OCR worker.
- `KURAKI_TRUST_PROXY=1` opts into deriving the client IP from
  `X-Forwarded-For`/`X-Real-IP`. Off by default so a directly-exposed server
  keys rate limits on the real TCP peer and forged headers cannot bypass the
  per-IP login and pairing throttles.
- The Docker image bundles `tesseract` so opt-in OCR works out of the box.
- Docker image with libvips and ffmpeg bundled, a `docker-compose.yml` for
  one-command hosting, a container health check that self-probes via the binary,
  a non-root runtime user, and OCI image labels.

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

### Fixed
- Filename search returned nothing for partial words (for example, searching
  "photo" missed "photo3.jpg"); search now matches on prefixes.

### Changed
- Positioned as a Docker-first, self-hosted application built around a libvips +
  ffmpeg media pipeline.

[Unreleased]: https://github.com/kuraki-app/kuraki/commits/main
