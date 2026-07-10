# Kuraki roadmap — daily-use plan

Kuraki exists to make a personal photo library **easy to keep, easy to find,
easy to send, and possible to recover without Kuraki**. This plan is ordered by
those recurring user jobs, not by competitor feature checklists.

## Product promise

> Take a photo, know the original is safely home, find it years later, share it
> deliberately, and retain a readable library if you ever leave Kuraki.

## What is already the baseline

Kuraki already has the server-side personal-library foundation: write-once date
organized originals; BLAKE3 deduplication; CLI/watch-folder and browser imports;
queue recovery; a timeline, search, Places, albums, favorites, memories, stacks,
duplicates, metadata editing, trash, stats, and activity; whole-library export;
and live SQLite-consistent backup/restore plus integrity verification.

Those features are maintained, but they are no longer the roadmap's primary
milestones. New work must improve a routine user job or make that job safer.

## 0. Release guardrail — the media contract

This runs alongside every release rather than blocking daily-use work with
unbounded format scope.

- Maintain a versioned support matrix with four explicit states: accepted,
  metadata, thumbnail/poster, and browser preview/playback.
- Test standard content signatures, derivatives, HTTP MIME/range responses, and
  download-only fallbacks. Camera RAW stays an extension-based exception until
  its fixture-backed decoder policy exists.
- Certify the Docker/libvips path with Chromium, Firefox, and WebKit before
  advertising wider HEIC/HEIF, TIFF, RAW, JXL, or exotic-video support.
- Show reduced pure-Go capability and actionable media-health recovery instead
  of silently promising unsupported previews.

## 1. Capture — make backup a daily habit (now)

**User job:** “I took a photo. Is the original safely on my server?”

### Server protocol

- Device registration and revocable device credentials; pairing must not expose
  the account password to long-lived clients.
- Resumable upload sessions with byte offsets, per-file receipts, idempotency,
  deduplication, expiry cleanup, and clear failure reasons.
- Per-device upload cursor, selected-source/album labels, Wi-Fi/cellular/power
  policy supplied by clients, and bounded server-side staging.
- Backup-status API: last successful item, pending bytes/items, skipped
  duplicates, failures, and storage consumption.

### React Native mobile app (iOS and Android)

- One shared Expo/React Native codebase; native background scheduling is treated
  as advisory and the UI always reports the operating-system constraint honestly.
- Pair with a server by QR code or a short-lived pairing code; store device
  credentials only in platform secure storage.
- Pick device albums/folders, back up only additions, resume interruptions, and
  show a plain-language “Backed up / waiting / needs attention” state.
- Initial app scope: Backup, Recent, Search, and Settings. It is not a complete
  replacement gallery on day one.

### Desktop companion

- Reuse the same session protocol for a small desktop uploader; retain the CLI
  and watch-folder path for servers and NAS imports.

**Exit criteria:** a new photo survives app restart and network loss without a
duplicate; the user can identify the exact receipt or failure; a device never
offers source cleanup until the server confirms the original is present.

## 2. Find — retrieve a moment in seconds (next)

**User job:** “Find the photo I remember, not just the file I named.”

- Mobile-friendly recent timeline with fast jump-to-date and an offline cache of
  recent thumbnails/metadata.
- One filter language across web and mobile: date, place, media type, camera,
  favorite, rating, album, archive/hidden, and saved search.
- Improve screenshot/document retrieval with opt-in local OCR before broad
  semantic search or face recognition.
- Keep memories, favorites, and Places as lightweight re-entry points; measure
  whether they earn a place on the home screen.

**Exit criteria:** common date/place/type queries complete quickly on a 10k-item
library, work identically on web and mobile, and do not require cloud ML.

## 3. Share — send deliberately, revoke confidently (then)

**User job:** “Send this set of photos without handing over my library.”

- Start with selected-item and album share links: expiry, password, download
  permission, revoke, and owner-visible access history.
- Add authenticated household albums only after the link permissions and audit
  model are tested. Contributor upload/collect mode comes last, with quotas and
  rate limits.
- Do not build comments, reactions, social feeds, or public discovery as part of
  the personal-backup product.

**Exit criteria:** a revoked link stops access immediately; a recipient cannot
enumerate unrelated assets; every public action is bounded and auditable.

## 4. Maintain — prove ownership over time (continuous)

**User job:** “Can I move, repair, or recover this library?”

- Stable external-library identity based on content hash and sidecar identity,
  not just a mounted filesystem path.
- XMP/JSON sidecar import and export plus a portable library manifest, so edits,
  captions, ratings, tags, and source identity remain usable outside Kuraki.
- Scheduled restore rehearsals into a disposable target; report restore result,
  integrity result, backup age, and storage-growth forecast in the dashboard.
- Safe source-cleanup recommendations only after a verified backup and restore
  evidence; never make deletion part of ordinary backup.
- Continue duplicate review, stacks, archive/hidden, trash, and whole-library
  export as maintenance tools.

**Exit criteria:** moving/remounting an external library retains its metadata;
a user can restore a current backup on a clean machine and see a recorded proof.

## Deliberately later

- Face recognition, people grouping, generic semantic search, and bundled GPU
  models: optional local modules only after Capture and Find are reliable.
- Multi-user roles, OIDC, public contribution flows, and partner sharing: after
  the Share permission model.
- S3, PostgreSQL, hardware workers, and million-asset deployment profiles:
  after real device usage makes them necessary.
- Broad format admission without fixture-backed preview/playback behaviour.

## Planning rules

1. A feature must improve Capture, Find, Share, or Maintain, or it waits.
2. Originals remain immutable; derivatives and edits are replaceable.
3. Every destructive-looking action requires a recoverable path and visible
   evidence.
4. Mobile clients consume a documented server protocol; they do not bypass the
   queue, deduplication, or activity record.
5. New cloud, ML, GPU, or database dependencies require a separate explicit
   decision.
