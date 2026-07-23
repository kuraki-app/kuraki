# Kuraki roadmap

Kuraki makes a personal photo library easy to keep, easy to find, and possible
to recover without Kuraki. This is a maintained delivery order, not a feature
wishlist. The evidence behind it is in
[PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md); shipped work
is recorded in [CHANGELOG.md](./CHANGELOG.md).

**Effort:** S = up to one engineering week; M = one to three weeks; L = three
to six weeks. New work must improve Keep, Find, or Maintain—or prove that an
existing promise works.

## Now — release and data-trust blockers

- **[production blocker] Truthful, certified media contract — Regular users and
  self-hosters — M.** Make Docker's libvips claim true with a tested `-tags
  vips` build while keeping native defaults pure-Go, or remove the broad-format
  claim. Publish a support matrix and certify import, derivative, MIME/range,
  and Chromium/Firefox/WebKit behavior for each advertised format. Do not claim
  HEIC/RAW/JXL or exotic-video preview without that proof.

- **[bug fix] Complete, scalable duplicate review — Large-library users — M.**
  Replace the newest-20k request-time quadratic comparison with a resumable,
  all-library dHash candidate-bucket job. Persist coverage/version and show
  completion; never delete automatically.

- **[production blocker] Portable metadata and demonstrated recovery —
  Self-hosters — L.** Add an idempotent XMP core subset for caption, date, GPS,
  rating, and tags plus a versioned Kuraki manifest for favorites, albums,
  archive/hidden, and saved searches. Originals remain immutable. Rebind
  external locations by canonical content identity, then add opt-in isolated
  restore rehearsals with integrity proof, backup age, and storage forecast.

- **[production blocker] Security and operational evidence — Internet-facing
  self-hosters — M.** Add security-header/origin coverage, private storage and
  backup permissions, deployment validation for TLS/secure-cookie/trusted-proxy
  settings, dependency/container scanning, Prometheus-compatible metrics, and
  structured security/operation audit events.

- **[production blocker] Mobile release certification — Mobile users — M.** Add
  iOS/Android identifiers and signed release profiles, decide crash/error
  reporting, and pass a physical-device matrix covering permissions, pairing,
  revoked tokens, restarts, offloaded media, large video, retries, battery,
  metered network, OS expiration, and user termination. Background backup is
  best-effort by OS design; add Wi-Fi/charging controls only if test evidence
  shows a need.

- **[production blocker] Capacity and regression evidence — Advanced
  self-hosters — L.** Publish reproducible 10k/50k/500k fixtures and budgets
  for import, timeline/search, queue recovery, duplicate processing, memory,
  WAL growth, backup, restore, and verification. Gate releases on those budgets
  and query plans.

## Next — after the release gates pass

- **[improvement] Safe source-cleanup guidance — Self-hosters — S.** Show a
  checklist only after a current backup, successful restore rehearsal, and
  integrity pass. Never automate deletion of a source.

- **[improvement] Practical web-library navigation — Regular users — M.**
  **Jump-to-date shipped** (`routes/+page.svelte` — a `CalendarDays` date input
  anchors the timeline via the date filter). **Saved-search UI shipped** too
  (`feat/web-saved-searches`): a Bookmark control saves the current filter set
  and applies/deletes saved searches over the pre-existing `/api/saved-searches`
  API. Defer slideshow until usage research shows a repeated viewing job.
  (Configurable grid density already shipped — `LibraryView.svelte`, persisted to
  `localStorage` under `kuraki:grid-density`. Progressive image loading also
  shipped: shimmer placeholder plus an opacity fade on decode in `AssetGrid`.)

- **[done] Timeline virtualization — all users — M.** README advertises a
  "virtualized, day/month-grouped timeline that stays smooth at large
  libraries". **Now implemented** (`AssetGrid.svelte`): day-group sections
  materialize only when near the viewport (an `IntersectionObserver` with a tall
  `rootMargin` buffer) and are replaced by a measured, fixed-height spacer
  otherwise, so on-screen DOM stays bounded regardless of library size.
  Browser-verified at 579 assets / 40 days (held at ~81 tiles / 6 live
  sections across all scroll positions). The *capacity budgets* at 10k/50k/500k
  remain owed under "Capacity and regression evidence" below — the mechanism
  exists; the large-library evidence does not yet.

- **[new feature] Smart albums — Organizers — M.** Build on saved searches with
  explicit ownership, preview, and reversible membership semantics.

- **[improvement] Fixture-first media expansion — Camera users — M per format.**
  Expand only formats that pass the support matrix; a decoder dependency alone
  is not user-visible support.

## Later — gated expansion, not commitments

- **[new feature] Non-destructive recipes and burst grouping — Enthusiast
  photographers — L.** Store reproducible edit recipes and capture groups
  outside originals; export their sidecar metadata.

- **[new feature] Optional local semantic search — Advanced users — L.** Require
  an approved local model, lifecycle/deletion controls, and recall/latency
  benchmarks. Exact search remains acceptable until embeddings create a measured
  need for a pure-Go approximate-neighbor design.

- **[new feature] S3/PostgreSQL/hardware workers — Homelab operators — L+.**
  Treat these as explicit architecture changes only after capacity evidence shows
  filesystem/SQLite limits; preserve the simple local default.

## Explicitly not doing

- Sharing, household accounts, OIDC, and multi-user roles: parked until
  single-owner recovery and operational evidence are complete.
- Automatic source deletion: unsafe without independently verified recovery.
- Bundled cloud ML, mandatory GPU use, face recognition, or ANN infrastructure:
  no approved user job or benchmark yet.
- Broad untested media promises, S3/PostgreSQL-before-evidence, and mobile
  release claims without physical-device certification.

## Release definition

Public launch requires every Now production blocker, a documented clean-machine
restore, deployment-guide validation, and trademark counsel clearance of
"Kuraki" for the initial US and India markets. This is a legal sign-off, not a
repository search.
