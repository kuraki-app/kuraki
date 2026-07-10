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
- `/healthz` liveness endpoint and a `/metrics` endpoint reporting memory,
  goroutines, uptime, and library counts.
- Configurable trash retention and thumbnail size via `KURAKI_TRASH_RETENTION_DAYS`
  and `KURAKI_THUMBNAIL_SIZE`.
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
- Uploads are processed by a background import queue: the request returns
  immediately, a worker imports each job with retries and crash recovery, and the
  UI polls progress. A self-refreshing Activity page lists recent import jobs with
  status, progress, and per-file error detail (which files failed and why).
- Google Takeout import: reads the JSON sidecars (tolerant of Google's naming
  variants) so capture dates, locations, captions, and favorites survive a
  migration from Google Photos.

**Browsing & search**
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

**Places**
- A map of geotagged photos (Leaflet + OpenStreetMap) with clustered thumbnails.
- Offline reverse geocoding resolves GPS to city and country names locally, with
  no external calls, and groups photos into a browsable list of places.

**Performance**
- Long-lived cache headers on originals and hashed UI bundles (immutable) and a
  week-long cache on thumbnails, so the timeline scrolls without re-fetching.
- Gzip compression for JSON and UI responses; SQLite cache, memory-mapped I/O,
  and in-memory temp store for faster queries.

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
