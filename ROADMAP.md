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

- **[done] Complete, scalable duplicate review — Large-library users — M.**
  **Already implemented** (migration `00018_production_proofs`, `internal/duplicates`):
  a durable, resumable, all-library background job — `duplicate_runs`
  (status/`algorithm_version`/`total`/`processed`/`group_count`, re-queued on
  restart) with **LSH candidate buckets** (`bands()` splits the 64-bit phash into
  9 bands) + union-find grouping, not a pairwise quadratic. `/api/duplicates`
  reads the persisted run (`duplicate_group_members`), never computing at request
  time. No 20k cap; coverage/version/completion tracked; never auto-deletes. The
  old "newest-20k request-time quadratic" this line described is gone.

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
  **Shipped foundation:** the owner console now has one DB-backed Settings area
  for operational controls, with explicit live/restart semantics and
  environment/CLI pinning. This does not close the blocker: deployment
  validation, scanning, and audit evidence remain required.

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

- **[done] Shared gallery design and bounded timeline rendering — all users.**
  The [UI audit and parity plan](./UI_PARITY.md) records shared Web/Mobile geometry,
  memories, album covers, progressive viewers and existing feature differences.
  `AssetGrid` now windows six complete rows inside each group, preserving exact
  gutter-aware spacer heights even for a single month containing 10,000 photos.
  The renderer fixture held 168 mounted tiles on desktop and 54 on phone. This
  proves renderer bounds; real 10k/50k/500k database, device and network budgets
  remain under the release capacity gate above.
  - [x] Shared reference-inspired gallery presentation and authenticated media integration.
  - [x] Web single-month 10k renderer, resize and existing-flow regressions.
  - [ ] Native visual/gesture and physical-device certification.
  - [ ] Complete Mobile metadata editing, saved-search/filter and export parity.

- **[done] Whole Web shell and Settings reliability — all Web users.**
  [Web redesign evidence](./WEB_REDESIGN.md): familiar Photos navigation,
  consistent cards/forms, accessible mobile Settings selection, preserved drafts,
  partial-load recovery and console-warning regression coverage.

- **[done] Consolidated responsive settings and mobile timeline controls —
  Self-hosters and phone users — S.** Stats, account, appearance, library,
  devices, activity, and server controls now share `/settings`; legacy routes
  redirect. Timeline controls and batch actions wrap without horizontal
  overflow, and virtualization estimates track the phone breakpoint/rotation.
  Browser-smoked at 390×844; the broader cross-browser release matrix remains
  part of the media/capacity evidence gates.

- **[done] Direct local-development workflow — Contributors — S.** Hot-reload and full-app source
  runs use host Go/Node processes. Docker consumes released images only for release verification or
  production deployment; the working-tree Docker helper is gone, and one safe cleanup target removes
  generated builds and test caches without touching installed JavaScript dependencies or library
  data.

- **[done] Mobile library refresh and Settings hierarchy — Mobile owners — S.** Pull-to-refresh now
  rechecks connectivity and reloads the active photo view, recycled thumbnails keep stable identities,
  the server summary avoids duplicate/trash totals, common preferences stay on the main page, and
  Activity lives under Advanced.

- **[done] Native-aligned mobile web and resilient PWA uploads — Phone browser users — S.** The
  phone layout now uses Photos, Collections, Settings, and Search like the native app, presents settings
  as four always-visible groups with a compact server summary, and installs with an offline
  application shell. Files a
  person selects are queued per account in browser storage and resume after reconnect/reopen, with
  Background Sync where supported. Browsers still cannot silently enumerate a camera roll; that
  automatic backup job remains in the native app.

- **[done] Consistent responsive web spacing — Web users — S.** Page gutters are 16px on phone
  widths and 24px with the desktop sidebar, regardless of route density. Mobile Settings uses one
  8/12/16px spacing rhythm, and the browser suite checks gutters and horizontal overflow from
  320px through 1440px.

- **[done] Shared adaptive design foundation — Web and mobile users — S.** One neutral token source
  now generates both clients' palette, spacing, radii, type scale, and responsive metrics. Inter is
  bundled on both surfaces, and existing Kura/Vault registers remain density patterns rather than
  separate visual identities.

- **[done] Shared micro-interactions — Web and mobile users — S.** Press, lift, enter, reveal,
  progress, and viewer-continuity patterns use the same timing and distance tokens on both clients.
  They provide feedback on high-value controls and stop when the system Reduce Motion preference is
  enabled.

- **[done] Guided mobile onboarding — New mobile users — S.** The four setup pages now share a
  responsive visual system, clear primary actions, lightweight page motion, and a persistent thin
  progress indicator. Server discovery, QR/manual pairing, and optional photo permission retain
  their existing behavior while showing less copy.

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

- Sharing, shared albums, household accounts, and OIDC: still parked. Kuraki's
  multi-user model is **isolated libraries** — there is deliberately no path
  from one account to another's photos, and no plan to add one without a
  separate design decision.
  (Multi-user itself unparked 2026-07-27 by human decision and shipped as
  admin-managed accounts; see AGENTS.md §11 `feat/multi-user-isolation`.)
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
