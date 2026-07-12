# Kuraki production-readiness audit

**Audit baseline:** `main` at `364a16e` (2026-07-12). This is a code and
documentation audit, not a certification that a public deployment is safe.
Evidence is from the repository, its tests and CI configuration, plus the
linked primary product documentation.

## Executive assessment

Kuraki has a credible single-owner library core: write-once originals,
BLAKE3 deduplication, resumable imports, derived media, queue recovery,
SQLite-consistent archives, integrity verification, and a practical web
library. The major release risk is not a missing consumer feature; it is the
gap between useful implementation and demonstrated production behavior.

The release bar should therefore be **proof of recovery, compatibility,
security, and capacity**, before broadening scope. `ROADMAP.md` is the
maintained priority order; this document records why.

Effort labels: **S** = up to one engineering week, **M** = one to three weeks,
and **L** = three to six weeks. They exclude third-party legal review and
physical-device availability.

## Implementation inventory

| Surface | Status | Confirmed capabilities | Audit assessment |
| --- | --- | --- | --- |
| Web library | Implemented | Timeline/search filters, viewer/downloads, uploads/Activity, albums, tags, ratings, archive/hidden, Places, duplicates, integrity and backup status, devices, settings, trash. | The feature breadth is real and the UI compiles, but there are no project-owned browser tests or browser interaction runs. Accessibility and dark-mode work is implemented, not independently certified. |
| Internal / operations | Implemented as CLI + owner APIs, not a separate app | `import`, `verify`, `backup`, `restore`, `passwd`, `/healthz`, authenticated `/metrics`, jobs/media health, scheduled backup and integrity status. | Good single-owner operational primitives. Metrics are JSON gauges only; there is no request/error telemetry, Prometheus exposition, audit-event stream, alert policy, or distinct admin surface. |
| Mobile | Partially production-ready | QR pairing, SecureStore credentials, resumable device upload, persisted camera-roll queue, album selection, background task registration, offline library cache, and viewer. | Typecheck and lint pass, but no project-owned mobile tests, signed release configuration, package identifiers, device-farm/physical-device certification, or crash reporting decision exist. Expo Go remains the documented first-run path. |

### Capability review

| Capability | Correctness and errors | Performance / UX | Coverage and required improvement |
| --- | --- | --- | --- |
| Imports and queue | Content admission, staging isolation, retry/recovery, Activity errors, and byte dedup are covered by Go tests. | Bounded derivative work and cursor pagination are appropriate for ordinary libraries. | Add 10k/50k/500k budgeted import, queue-recovery, and WAL tests before describing scale as production proven. |
| Media | The importer records media health and falls back to download-only behavior rather than rendering known-incompatible originals. | Preview/playback derivatives are a sound UX fallback. | Fixture and multi-browser certification is absent; format claims must follow a support matrix. |
| Duplicates | Review is opt-in and never deletes automatically. | `duplicates.go` limits candidates to 20,000 newest images and then compares every pair. This can omit older results and is quadratic. | Replace with a resumable all-library job and deterministic candidate buckets; expose coverage and completion. |
| Backup, restore, verify | Live backup snapshots SQLite; restore stages and validates an archive manifest; verify rechecksums originals. | Dashboard reports backup/integrity state. | Add scheduled isolated restore rehearsals, post-restore verification, private artifact permissions, and recorded proof. Current unit tests are strong but are not a clean-machine rehearsal. |
| Search and organization | Shared filters, FTS, tags, saved searches, stacks, Places, and offline mobile cache are implemented. | The timeline expression index has a documented 50k query-plan check. | Keep saved searches as the base for smart albums; do not add semantic infrastructure before an approved user need and benchmark. |
| Auth and deployment | Argon2id, opaque sessions, rate-limited login/pairing, Secure cookies, proxy guidance, and an offline password reset exist. | Caddy deployment guidance is clear. | Add security-header/origin coverage, deployment assertions, private on-disk permissions, dependency/container scanning, and actionable operational metrics. |
| Mobile backup | Chunk offsets, retry/re-alignment, persisted completion state, and device-token revocation handling are implemented. | Background work is intentionally best-effort; the UI communicates failure states. | Certify real iOS/Android behavior including iCloud-offloaded assets, system expiration, user termination, battery, and metered networks before calling it production ready. |

## Documentation and implementation drift

This audit corrects the current README and Docker comments for the first item
below; the remaining entries are baseline findings that require production work.

1. **Docker media claim was false at the audit baseline — production blocker.**
   `Dockerfile` installs libvips but builds the Go binary with `CGO_ENABLED=0`;
   build tags therefore select `internal/app/processor_purego.go`, not
   `processor_vips.go`. The baseline README and Docker comments claimed
   HEIC/AVIF/RAW previews "work out of the box" while the pure-Go backend cannot
   decode HEIC/RAW. This documentation change reduces those claims; the release
   work is to build and certify a `-tags vips` Docker profile.
2. **Migration rollback is present but not proven.** All released migrations
   have Goose Down sections and upgrades take a pre-migration snapshot. CI only
   verifies fresh setup and a no-op re-run; it does not test historical fixtures
   through up/down/up or establish that snapshots are the supported data
   rollback method.
3. **"Internal/admin" needs accurate language.** The product has owner-facing
   operational endpoints and CLI commands, not an independently implemented
   administrator application. Documentation should call it "operations tools".
4. **Production mobile status is overstated if interpreted as a store release.**
   `mobile/app.json` has no iOS bundle identifier or Android package and there
   is no release profile. The client is functionally useful but not release
   certified.
5. **Scale evidence is narrower than the roadmap needs.** The 50k timeline
   query-plan claim is useful; it does not establish importer, duplicate,
   backup, restore, verify, memory, or WAL behavior for 10k–500k libraries.

## External research used for decisions

- [PhotoPrism metadata support](https://docs.photoprism.app/user-guide/library/metadata/)
  demonstrates the value of sidecars and keeping originals unchanged; its
  limited XMP support also argues for a documented core subset, not a promise to
  parse every namespace.
- [PhotoPrism indexing](https://docs.photoprism.app/user-guide/library/index.html)
  distinguishes importing from indexing an existing read-only library, which
  supports durable source identity and explicit rescan behavior.
- [PhotoStructure 2026.4](https://photostructure.com/about/v2026.4/) documents
  recent fixes for canonical paths, same-byte identity, long scans, and
  unnecessary sidecar rewrites. Kuraki should make sidecar export idempotent and
  treat content hash as canonical identity.
- [Immich mobile backup](https://docs.immich.app/features/mobile-backup/) uses
  selected albums and content checksums to avoid duplicate uploads; Kuraki
  already has those foundations.
- [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/)
  and [Apple background tasks](https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app)
  make clear that scheduling is deferrable and system-controlled, not a delivery
  guarantee. Physical-device testing is a release gate, not polish.
- [hnswlib](https://github.com/nmslib/hnswlib) is evidence that approximate
  nearest-neighbor indexes are a later scale pattern. Its C++ implementation is
  incompatible with Kuraki's default no-CGO build, so it is not a current
  dependency proposal.

## Production release checklist

### Data and recovery

- [ ] Docker/media support matrix is truthful and passing in both pure-Go and
      libvips profiles; advertised format/browser combinations have fixtures.
- [ ] Every scheduled backup has a successful isolated restore rehearsal and
      post-restore integrity result recorded in the dashboard.
- [ ] XMP core subset, Kuraki manifest, and external-source rebind behavior are
      round-trip tested without changing originals.
- [ ] Migration tests cover supported historical upgrades and up/down/up;
      documentation identifies the snapshot as the user rollback path.
- [ ] Backups, snapshots, staging, database, and data directories are private
      to the service account or explicitly rejected/warned as unsafe.

### Security and operations

- [ ] HTTPS, secure cookies, and trusted-proxy topology are validated by an
      automated deployment test; security headers and origin/CSRF behavior are
      covered.
- [ ] Dependency and container vulnerability scans run in CI with an ownership
      and remediation policy.
- [ ] Prometheus-compatible metrics, structured security/operation audit events,
      queue/backup/verify/media failure counters, and documented alert thresholds
      are available.

### Capacity and clients

- [ ] Reproducible 10k/50k/500k datasets publish budgets for import, search,
      timeline, queue recovery, duplicate processing, memory, WAL growth,
      backup, restore, and verify.
- [ ] Duplicate review covers all eligible images and displays job coverage.
- [ ] Signed iOS and Android builds, identifiers, release profiles, crash/error
      reporting choice, and the physical-device matrix are complete.
- [ ] A clean-machine restore and the production deployment guide have been
      rehearsed by someone other than the implementation author.
- [ ] Trademark counsel has cleared "Kuraki" for the initial US and India launch
      markets; this is a legal sign-off, not a repository search.

## Explicitly excluded until evidence changes

- Sharing, household accounts, OIDC, and multi-user sync remain parked: they
  change the threat model and conflict semantics before single-owner recovery is
  proven.
- Automatic source deletion is excluded: guidance may be shown only after
  restore evidence; ordinary backup never deletes a source.
- Bundled cloud ML, GPUs, semantic search, face recognition, and ANN indexes are
  excluded until an approved local-intelligence job and benchmark require them.
- S3, PostgreSQL, and hardware workers are architecture-change proposals after
  filesystem/SQLite capacity evidence, not remedies for unmeasured scale.
- Broad media-format claims are excluded until fixture and browser certification
  demonstrates them.
