# Kuraki Roadmap

> Forward-looking plan for where Kuraki is headed. For a record of what has
> already been built and fixed, see **[CHANGELOG.md](./CHANGELOG.md)**.

Kuraki today is a working, single-owner, self-hosted photo & video backup server:
CLI and browser import with content-hash dedup, a searchable web timeline and
viewer, favorites, albums, "on this day", trash with retention, integrity
verification, video with in-browser playback, and Docker-first deployment. The
server-side foundation is in place; the web UI is catching up to it, and the
items below are where we go next.

## Design decisions (context)

| Area | Choice |
|---|---|
| Server | Go, embedded SvelteKit web UI |
| Database | SQLite (WAL) with FTS5 search and versioned, snapshot-protected migrations |
| Media | libvips + ffmpeg, behind an interface with a pure-Go fallback |
| Storage | Filesystem, write-once originals, behind a storage interface (object storage later) |
| Identity | UUIDv7 keys and `owner_id` on every asset from day one |
| Distribution | Docker image with the media toolchain bundled |
| License | AGPL-3.0 |

---

## Near-term — finish and polish the current experience

Achievable now with the existing architecture:

- **Full HEIC / AVIF / RAW previews** by shipping the libvips-backed build as the
  default container image (iPhone HEIC is the common case).
- **Tags / keywords** and **saved searches** (smart albums) for richer organization.
- **Duplicate review dashboard** — surface exact and near-duplicate candidates for
  the user to resolve, building on the existing content-hash dedup.
- **Google Takeout import** that reads the JSON sidecars so dates, captions, and
  geolocation survive the migration — a key path for people leaving Google Photos.
- **Bulk metadata tools**: correct capture dates, shift timezones, set or clear GPS.
- **Library dashboard**: storage usage, counts by type and year, import history.
- **Slideshow** mode and a one-click **download / export** of the whole library.
- **Configurable** trash retention and thumbnail sizes.
- **Import queue** with retries, a jobs view, and clearer per-file error reporting.

## Planned — parity with other photo apps

### Organization & discovery
- **Archive / hidden** section to keep clutter out of the main timeline.
- **Stacks**: group burst shots and RAW+JPEG pairs into a single tile.
- **Live / motion photo** pairing (image + short clip shown together).
- **Ratings** alongside favorites, and manual + auto-generated albums.

### Sharing & multi-user
- **Multi-user accounts** with an admin role (schema already carries `owner_id`).
- **Shared albums** between users and **partner sharing** of a whole library.
- **Public share links** with optional password and expiry.
- **OIDC / OAuth** single sign-on for households already running an identity provider.
- Album **activity** (comments / reactions) for shared albums.

### Intelligence (opt-in, external — never bundled by default)
- **Natural-language / semantic search** ("red car", "beach at sunset") via an
  optional CLIP sidecar; embedding columns are already reserved in the schema.
- **Face detection & people grouping** through an opt-in sidecar.
- **Scene / object tagging** and **quality flags** (blurry, duplicate, screenshot).

### Media handling
- **Adaptive video transcoding** so clips play on any device, not just when the
  original is web-compatible.
- **Deeper RAW support** (embedded-preview extraction now; optional develop later).
- **Basic non-destructive editing**: crop, rotate, straighten, light adjustments,
  keeping the original untouched.

### Mobile & desktop
- **Mobile apps** (iOS / Android) with automatic background backup — the biggest
  driver of daily use. The sync API (change log + per-device cursors) is already
  reserved in the schema.
- **Desktop background uploader** for folks who live on a laptop.

## Exploring — infrastructure & scale

- **Object-storage backend** (S3-compatible) behind the storage interface.
- **Postgres driver** for hosted / multi-tenant deployments.
- **External libraries**: index files in place without copying them in.
- **WebDAV / rsync** ingestion endpoints.
- **Encryption at rest** as an option (distinct from end-to-end encryption).

## Improving how it works (quality & reliability)

- Cache-friendly derivative responses and **blurhash/placeholder** thumbnails for
  instant-feeling scrolling.
- **Prometheus** exposition format for `/metrics`, with import and verify counters.
- **API tokens** for scripting and third-party clients.
- **Backup & restore** command that bundles the database and configuration.
- Graceful degradation and clear messaging when ffmpeg or libvips is unavailable.
- **Internationalization**, accessibility, and dark mode across the UI.
- End-to-end and load tests, plus published large-library performance numbers.
- Broader rate limiting and an optional **audit log** of sensitive actions.

## Explicit non-goals

- **Server-side end-to-end encryption** — it conflicts with server-side thumbnails
  and search; people who need E2EE are better served by Ente.
- **Bundling ML by default** — intelligence stays optional and external so a base
  install remains simple.
- **Chasing feature-count parity for its own sake** — every addition should earn
  its place against simplicity and reliability.

---

*Have an idea or a gap you want closed? Open an issue — see
[CONTRIBUTING.md](./CONTRIBUTING.md).*
