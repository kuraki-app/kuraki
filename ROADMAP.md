# Kuraki roadmap

> This is the forward plan. Shipped work and fixes live in
> **[CHANGELOG.md](./CHANGELOG.md)**. Priorities deliberately favour a reliable,
> fast personal library over feature-count parity.

Kuraki is a single-owner, self-hosted photo and video backup server with
write-once originals, hash deduplication, a queued importer, browser library,
offline places, search, albums, metadata editing, trash, verification, and a
Docker-first media pipeline. The next milestone is not "more formats" on a
marketing page: it is a clear, tested promise about what can be imported,
previewed, and played in every supported browser.

## Product direction

**Own the library.** A person should be able to move a lifetime of media into
Kuraki, find it quickly, know that it is intact, and take it elsewhere without
special tooling. Kuraki should remain smaller and easier to operate than
Immich, while borrowing the workflows people genuinely depend on: dependable
mobile backup, compatible playback, sharing, and organization.

| Principle | Product consequence |
|---|---|
| Originals are the source of truth | Never alter an imported original; previews, edits, and transcodes are replaceable derivatives. |
| Compatibility is explicit | Import, thumbnail, full-size preview, and browser playback are separately tested states. |
| Fast on modest hardware | Bound every worker queue, generate derivatives on demand or in the background, and make acceleration optional. |
| Privacy by default | Offline geocoding and local search stay local; ML is opt-in and removable. |
| Recoverability beats cleverness | Backups, verification, upgrade safety, and clear failure recovery come before scale features. |

## Current media compatibility — audited 2026-07-10

The table describes the code today, not an aspirational claim. “Imported” means
the extension is currently admitted by the importer; it does not guarantee a
full-size preview or playback in every browser.

| Kind | Imported today | Grid thumbnail / poster | Full-size website view today | Decision |
|---|---|---|---|---|
| JPEG, PNG, GIF, WebP | Yes | Yes with pure-Go; WebP with libvips | Yes in current browsers; GIF remains animated from the original | Keep and fixture-test. |
| AVIF, HEIC/HEIF, TIFF | Yes | libvips image required for dependable thumbnail generation | AVIF is broadly usable; HEIC/HEIF and TIFF are not portable web viewer formats | Generate a browser-safe full-size preview; never point `<img>` at an unsupported original. |
| RAW camera files | No extension admission today | Not guaranteed | No | Add only after embedded-preview extraction and a RAW fixture suite. |
| BMP, SVG, JPEG 2000, JPEG XL | No extension admission today, despite libvips being able to read some builds | Not guaranteed | Varies or is unsafe for direct rendering | Do not admit by extension until capability probing, safe preview generation, and security policy exist. |
| MP4, M4V, MOV, WebM | Yes | JPEG poster through ffmpeg when available | Direct `<video>` uses the original; actual success depends on its container *and codecs* | Preserve original and create a compatible playback derivative when needed. |
| MKV, AVI, 3GP, MPEG/TS, WMV and camera variants | No | No | No | Add through ffprobe classification plus compatibility transcoding, not a larger extension switch. |

### Media support contract (release gate)

Kuraki will publish a versioned support matrix with four states for every
format: **accept**, **metadata**, **thumbnail/poster**, and **web preview or
playback**. A file that is safe to preserve but cannot be rendered must still
be importable when the user chooses it, show an honest “original only” state,
and offer download. It must not repeatedly fail a queue job after the original
has already been stored.

The portable web targets are JPEG/PNG/WebP/AVIF for images and H.264 + AAC in
MP4 for video. WebM (VP8/VP9/AV1 + Opus) is an additional direct-play target;
HEVC, MOV, and MP4 are containers/codecs with uneven browser support and must
be checked per file. See [MDN’s image guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)
and [web video codec guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs).

## Delivery plan

### R1 — dependable release and complete media contract

**Goal:** a new user can trust an import and open every advertised file type.

- Replace extension-only admission with content detection and a capability
  registry (`accepted`, `metadata`, `preview`, `playback`, `download-only`).
- Use `ffprobe` to capture video dimensions, duration, rotation, codecs, HDR,
  and audio; persist the result and show it in the viewer and Activity errors.
- Ship the libvips + ffmpeg Docker path as the supported production profile,
  while making the pure-Go binary clearly report its reduced capability set.
- Generate a browser-safe image preview for HEIC/HEIF, TIFF, RAW, JXL, and
  other non-web originals; retain the original for download. Use a safe raster
  preview for SVG rather than serving untrusted SVG inline.
- Detect browser-incompatible video and queue a resilient MP4 (H.264/AAC)
  playback derivative, with a per-asset status, retry/cancel controls,
  resource limits, and original-download fallback. Add optional HLS only for
  long or high-resolution video after the MP4 path is reliable.
- Add correct orientation, animated-image policy, Live/Motion Photo pairing,
  HDR/10-bit thumbnail and video tone-mapping policy, and 360°/panorama
  metadata detection.
- Build a licensed, versioned media fixture corpus and CI matrix across the
  Docker and pure-Go profiles. It must assert import outcome, metadata,
  derivative decodability, HTTP MIME/range headers, and actual browser
  playback with Chromium, Firefox, and WebKit.
- Add a media-health report: unsupported files, derivative failures, stale
  derivatives, and one-click retry/rebuild. This turns the existing Activity
  view into an actionable recovery surface.

**Exit criteria:** all rows in the published matrix have tests; every accepted
file has a successful preview/playback path or an explicit download-only state;
no unsupported derivative causes an endless retry; mixed-library browser tests
pass on the three engines.

### R2 — library control and migration confidence

**Goal:** people can move from Google Photos/iCloud/NAS and keep a large library
well organized without turning Kuraki into a heavyweight DAM.

- Tags/keywords, hierarchical tags, ratings, archive, and hidden/locked
  sections; include saved searches and smart albums over date, type, camera,
  place, tags, rating, and favorite state.
- Duplicate and near-duplicate review with a conservative “keep both” default;
  group burst shots, RAW+JPEG pairs, and Live/Motion Photo pairs into stacks.
- External read-only libraries and folder view, with stable sidecar identity,
  exclusion patterns, rescans, and clear write limitations. Do not repeat the
  common failure mode where a move loses the application’s metadata.
- XMP sidecar import/export and a non-destructive edit recipe (crop, rotate,
  straighten, light adjustments). Originals remain immutable.
- Full library export, manifest-based backup/restore, scheduled integrity
  verification, restore drills, storage usage forecast, and documented 3-2-1
  backup guidance.
- Useful polish: jump-to-date, configurable grid density/layout, slideshow,
  keyboard and screen-reader audit, dark mode, localization foundation, and
  progressive placeholders.

**Exit criteria:** a Google Takeout and a mounted folder can be migrated and
re-imported without metadata loss; a documented backup restore succeeds on a
clean instance; common organization actions work without full-library scans.

### R3 — safe sharing and household accounts

**Goal:** make a household useful without compromising single-owner simplicity.

- Turn the existing `owner_id` boundary into multi-user accounts, roles,
  storage quotas, session/device management, recovery codes, TOTP/passkeys,
  and OIDC.
- Shared albums with viewer/contributor roles, per-item attribution, comments
  or reactions, and notifications. Start with authenticated sharing.
- Public links with expiry, password, download permission, revocation, access
  limits, and optional collect mode for events. Add an audit trail and strict
  upload quotas/rate limits before public contribution.
- Partner sharing and selected automatic albums only after the permissions
  model has been proven with tests and export/revocation flows.
- API tokens and a documented, versioned API for trusted automation.

**Exit criteria:** authorization, revocation, and album contribution are tested
end-to-end; an owner can export their own library independently; public links
cannot bypass rate, quota, or audit controls.

### R4 — mobile and desktop backup clients

**Goal:** Kuraki becomes a backup habit, not merely a server one visits.

- iOS and Android apps with resumable, deduplicated background upload;
  per-album selection/exclusion; Wi-Fi/charging/cellular controls; upload
  receipts; and honest OS-background status.
- One-way device-album sync, configurable post-backup space cleanup with a
  review screen, and a read-only/kid mode. Keep deletion separate from backup.
- Desktop background uploader with watch folders, bandwidth/power schedules,
  local queue recovery, and a simple migration assistant.
- Device cursors using the reserved change log, conflict rules, and a local
  offline cache for recently viewed media.

**Exit criteria:** a new phone can back up a large selected library across
network interruptions without duplicates or silent data loss, and exposes a
per-file recovery log.

### R5 — opt-in intelligence, only after the foundation is boring

**Goal:** better discovery without mandatory cloud processing or a heavy base
install.

- Optional local/sidecar face detection and people confirmation; semantic
  object/scene search; OCR for screenshots/documents; and quality flags.
- User-controlled model download, CPU/GPU limits, pause/resume, deletion of
  embeddings, re-indexing, and no silent outbound media upload.
- Smart albums and clean-up suggestions consume these signals, but every action
  remains reviewable and reversible.

### R6 — scale and deployment options

**Goal:** retain the simple default while supporting capable homelabs.

- S3-compatible storage backend, optional PostgreSQL deployment profile, and
  replicated/off-site backup targets behind stable interfaces.
- Hardware-assisted derivative and transcode workers with explicit capability
  detection, CPU-only fallback, queue observability, and quality presets.
- Prometheus-format metrics, structured audit events, load/soak tests, and
  published benchmarks for 10k, 100k, and 1M-asset libraries on modest
  hardware.

## Explicit non-goals and sequencing rules

- No server-side end-to-end encryption: it conflicts with server-side previews,
  search, and flexible playback. Ente is the stronger choice where E2EE is the
  primary requirement.
- No bundled ML model or mandatory GPU. Both stay optional.
- No destructive original-library management by default. External libraries
  are read-only until a user explicitly enables and understands write mode.
- No broad extension list without a preview/playback contract and fixtures.
- Do not start R3–R6 before R1’s media contract and R2’s backup/restore exit
  criteria are met.

## Why these priorities

Immich’s current feature set validates the demand for mobile backup, sharing,
external libraries, stacks, RAW, and hardware transcoding, while its own docs
also highlight external-library cache/metadata edge cases worth avoiding.
Kuraki should copy the user outcome, not its operational weight. See
[Immich features](https://immich.app/features),
[external-library limitations](https://immich.app/docs/features/libraries), and
[supported formats](https://docs.immich.app/features/supported-formats/).

Ente validates the high-value interactions around archive/hidden media,
collaboration, public collection links, and reliable background clients. Its
privacy model is intentionally different, but its sharing controls and
performance-driven gallery work are useful product references. See
[Ente’s feature overview](https://next.ente.io/),
[sharing controls](https://help.ente.io/photos/faq/sharing-and-collaboration),
and [its gallery-performance roadmap](https://ente.io/blog/building-the-best-photos-app/).
