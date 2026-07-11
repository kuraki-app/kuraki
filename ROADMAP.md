# Kuraki roadmap — daily-use plan

Kuraki exists to make a personal photo library **easy to keep, easy to find,
and possible to recover without Kuraki**. This plan is ordered by those
recurring user jobs, not by competitor feature checklists. Shipped work and
fixes live in **[CHANGELOG.md](./CHANGELOG.md)**.

## Product promise

> Take a photo, know the original is safely home, find it years later, and
> retain a readable library if you ever leave Kuraki.

## What is already shipped

**Foundation.** Write-once, date-organised originals; BLAKE3 deduplication;
CLI / watch-folder / browser imports; a crash-recovering import queue with an
Activity view; libvips/pure-Go thumbnails, ffmpeg posters, and per-asset
web-viewability with playback/preview derivatives; timeline, viewer, Places,
albums, favorites, memories, stacks, duplicate review, metadata editing, tags,
saved searches, ratings, archive/hidden, trash; whole-library export; live
SQLite-consistent backup/restore; opt-in scheduled backups with a dashboard
backup-age indicator; scheduled integrity verification; owner password change
plus an offline `kuraki passwd` recovery command; and a production deployment
guide (Caddy automatic HTTPS).

**Capture — backup is a daily habit** *(complete)*. Revocable device tokens and
resumable upload sessions; a React Native iOS/Android client that automatically
backs up the camera roll with a persisted, restart- and network-loss-safe queue;
OS background scheduling; streamed large-file uploads; QR pairing; and per-album
selection.

**Find — retrieve a moment in seconds** *(complete)*. One filter language
(query, date, media type, camera, favorite, rating, place, album, archive/hidden)
over a single paginated search, used identically by the web timeline, the web
search, and the mobile Library tab; a device-authenticated library read with an
offline cache; and opt-in, fully local OCR that makes text inside screenshots
and documents searchable.

Those areas are maintained but are no longer primary milestones. New work must
improve a routine user job or make that job safer.

## 0. Release guardrail — the media contract

Runs alongside every release rather than blocking daily-use work with unbounded
format scope.

- Maintain a versioned support matrix with four explicit states: accepted,
  metadata, thumbnail/poster, and browser preview/playback.
- Test standard content signatures, derivatives, HTTP MIME/range responses, and
  download-only fallbacks. Camera RAW stays an extension-based exception until
  its fixture-backed decoder policy exists.
- Certify the Docker/libvips path with Chromium, Firefox, and WebKit before
  advertising wider HEIC/HEIF, TIFF, RAW, JXL, or exotic-video support.
- Show reduced pure-Go capability and actionable media-health recovery instead
  of silently promising unsupported previews.

---

# Forward plan

Sharing (public/household links, contributor uploads, multi-user accounts) is
**parked by decision** — see [Parked](#parked-not-being-built-now). The active
sequence below is about trust, reliability, and staying light.

## 1. Maintain — prove ownership over time (now)

**User job:** “Can I move, repair, or recover this library — with proof?”

- **Portable metadata.** XMP/JSON sidecar import and export plus a versioned
  library manifest, so edits, captions, ratings, tags, GPS, and source identity
  remain usable outside Kuraki. Originals stay immutable.
- **Stable external-library identity** based on content hash and sidecar
  identity, not just a mounted filesystem path, so moving or remounting a folder
  never loses the application's metadata.
- **Restore rehearsals.** Scheduled test restores into a disposable target that
  record a result; the dashboard reports last restore result, integrity result,
  backup age, and a storage-growth forecast. *(Shipped so far: opt-in scheduled
  backups with pruning, and last-backup age/outcome + integrity result on the
  dashboard. Still to do: automated restore rehearsals and the storage forecast.)*
- **Safe source cleanup.** Recommend removing originals from a source only after
  a verified backup and restore evidence; never make deletion part of ordinary
  backup.
- Continue duplicate review, stacks, archive/hidden, trash, and whole-library
  export as maintenance tools.

**Exit criteria:** moving or remounting an external library retains its metadata;
a user can restore a current backup on a clean machine and see recorded proof
(restore + integrity + age) in the dashboard.

## 2. Harden — make the good behaviour boring (continuous)

**User job:** “Does it keep working, look right, and stay trustworthy?”

- **Media-contract certification.** Build the licensed fixture corpus and CI
  matrix across the Docker/libvips and pure-Go profiles, asserting import
  outcome, metadata, derivative decodability, HTTP MIME/range, and real browser
  playback on Chromium, Firefox, and WebKit. Closes the roadmap guardrail.
- **Mobile real-device shakeout.** Exercise the Capture and Library flows on
  physical iOS and Android hardware (background cadence, large videos, iCloud
  offloaded assets, permission edge cases) before calling the client production
  ready.
- **Web experience polish.** Jump-to-date, configurable grid density, slideshow,
  a keyboard and screen-reader audit, dark mode, a localization foundation, and
  progressive image placeholders. *(Shipped: dark mode and the keyboard/
  screen-reader audit, via the shadcn-svelte rebuild. Still to do: jump-to-date,
  grid density, slideshow, localization, progressive placeholders.)*
- **Operational edges.** Ship tesseract in the Docker image so opt-in OCR works
  in the container; add indexes ahead of large libraries; publish a low-resource
  benchmark. *(Shipped: tesseract in the image; album and timeline-sort indexes
  verified against a 50k-asset library; a production deployment guide with a
  Caddy auto-HTTPS stack. Still to do: the published low-resource benchmark.)*

**Exit criteria:** every advertised format has a passing fixture test on both
profiles; the mobile client has a signed-off device pass; the web UI meets a
basic accessibility and dark-mode bar.

## 3. Organize deeper — optional, non-destructive (later)

**User job:** “Shape my library without risking the originals.”

- Non-destructive edit recipes (crop, rotate, straighten, light adjustments)
  stored as sidecar instructions; originals never change.
- Burst-shot grouping alongside the existing RAW+JPEG / Live-Motion stacks.
- Smart albums over the shared filter language, and clean-up suggestions that
  are always reviewable and reversible.

## 4. Optional local intelligence — only after the foundation is boring

**User job:** “Help me find people and things, without sending my photos away.”

Opt-in, on-device or self-hosted only; user-controlled model download,
CPU/GPU limits, pause/resume, deletion of embeddings, and no silent outbound
upload. Local OCR already ships as the first, safest example.

- Face detection and people confirmation; semantic object/scene search;
  quality flags. Each signal feeds smart albums but every action stays
  reviewable and reversible.

## 5. Scale & deployment — keep the simple default, enable homelabs

**User job:** “Run this on bigger or off-site infrastructure when I need to.”

- S3-compatible storage backend and an optional PostgreSQL deployment profile
  behind the existing interfaces; replicated / off-site backup targets.
- Hardware-assisted derivative and transcode workers with capability detection
  and CPU-only fallback.
- Prometheus-format metrics, structured audit events, load/soak tests, and
  published benchmarks for 10k / 100k / 1M-asset libraries.

## Parked (not being built now)

Deferred by decision, kept here so the design intent is not lost:

- **Sharing and household accounts** — selected-item/album share links with
  expiry, password, download permission, revoke, and audit; authenticated
  household albums; contributor/collect mode; multi-user roles, OIDC, and
  partner sharing. Revisit after Maintain and Harden.
- Broad format admission without fixture-backed preview/playback behaviour.
- Bundled ML models or a mandatory GPU.

## Planning rules

1. A feature must improve **Keep, Find, or Maintain**, or it waits.
2. Originals remain immutable; derivatives, edits, and sidecars are replaceable.
3. Every destructive-looking action requires a recoverable path and visible
   evidence.
4. Mobile and desktop clients consume a documented server protocol; they do not
   bypass the queue, deduplication, or activity record.
5. New cloud, ML, GPU, or database dependencies require a separate explicit
   decision. Sharing/multi-user stays parked until deliberately unparked.
