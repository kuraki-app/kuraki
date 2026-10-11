# Pre-deployment review — 11 October 2026

**Remediation status (11 October 2026):** the 22 implementation findings below are fixed on `codex/pre-deployment-hardening`, with regression and artifact evidence recorded here and in [DEPLOYMENT_FIX_PLAN.md](./DEPLOYMENT_FIX_PLAN.md). Target-host and hardware certification remain explicit release conditions. The original findings and probe results are preserved as a historical baseline; their source links point at prerequisite commit `0796be3`.

## Remediation and final evidence

| Finding | Implemented correction |
| --- | --- |
| 1 | Complete signature bounds, short-input/fuzz coverage, per-job panic containment. |
| 2 | Transactional single setup claim, bounded credentials/body reads, two concurrent credential operations with overload rejection. |
| 3 | Durable failure/cancellation receipts; failed staged sources retained; cleanup only after successful ingestion. |
| 4 | Authenticated account IDs used by web/device queue and importer without creating ghost users. |
| 5 | Explicit archive close/sync checks and atomic publication preserving earlier successful output. |
| 6 | Cross-process snapshot coordination with purge, rebuild and external removal; snapshot original references validated. |
| 7 | Restore/purge serialization and eligibility revalidation under lock. |
| 8 | Migration 00029 persists/backfills job ownership; list/details are private to their account. |
| 9 | Managed-root ancestor/descendant rejection and symlink/special-file exclusion. |
| 10 | Server checks expected account before staging; browser/service worker stop or retain work on identity mismatch. |
| 11 | Go 1.26.9 and patched x/crypto/x/net dependencies; reachable-symbol and image scans pass. |
| 12 | Random queue IDs work on ordinary HTTP LAN origins. |
| 13 | Shared verification gates binary/image/release publication; each architecture's candidate is exercised/scanned before that same image is pushed. |
| 14 | Docker restore mounts a writable parent and installs into an absent child; exact-image restore demonstrated. |
| 15 | Gzip stream drained and trailer validated before restore installation. |
| 16 | Catalog-only soft deletion, legacy recovery and migration 00030 durable permanent cleanup. |
| 17 | Original image/video capability re-probed; required stored derivatives checked before clearing health; unsupported repair stays visible. |
| 18 | Bounded/coalesced manual work owned, cancelled and joined by the application lifecycle. |
| 19 | Instant-span Trip identity survives repeated detection and later expansion. |
| 20 | Compatible frontend dependency updates; npm audit reports zero advisories. |
| 21 | Endpoint-specific JSON/credential limits and request-body deadlines preserve streaming upload/export policy. |
| 22 | Shared external-source resolver supports initial derivatives, read/verify/rebuild/export and catalog trash while preserving external bytes. |

Additional corrections: account-scoped persisted/live sync cursors, feed-head reset after restore, disabled-account login rejection, administrator-only operational status/metrics, canonical trusted proxy forwarding, UID/GID 10001 mount provisioning in every install entry point, resolved deployment preflight, and a smaller Docker build context that excludes private data/configuration. The review follow-up caught video decoder dispatch and derivative retirement races; both now have regressions and both review axes report no remaining finding in those fixes.

Final local evidence:

- Pure-Go `make check` (format/vet/race), supported Linux amd64/arm64, Darwin arm64 and Windows amd64 builds, contract generation, embedded UI consistency, deployment preflight tests (6), workflow lint and documentation links passed.
- Web type/build/unit checks (36 tests), size budgets and all 124 Chromium browser checks passed, including a non-secure LAN hostname and a cookie switch between queued files. Mobile type/lint checks and 288 tests passed; marketing-site build passed.
- The built ARM64 libvips runtime image `sha256:fb28a491e5bc2855593fa03f1629c387de89da3063eb32efa0a4cb7cdc25ea7c` passed startup → setup → web/device ingestion → thumbnail → restart → live backup → isolated restore → verify → trash/restore. Restored bearer access returned the original device bytes. This is a local candidate identity, not a published release digest.
- An isolated Caddy deployment passed TLS, Secure cookies, HSTS and forged forwarding-header throttle checks. Its internal test CA does not certify real DNS or public certificate renewal.
- Trivy 0.75.0 found zero **fixable HIGH/CRITICAL** vulnerabilities in this image's Debian packages and Go binary. The initial scan found Perl-base and Go module advisories; upgrading Debian packages and x/crypto/x/net cleared them. Lower severity and currently unfixable packages are outside that gate.
- `govulncheck` found zero vulnerable reachable symbols and zero vulnerable imported packages. It still reports module-only `GO-2026-5932` for unmaintained `x/crypto/openpgp` (no fixed version); Kuraki does not import that package. This is a documented non-reachable advisory, not an ignored reachable finding.
- Full `go test -race -tags vips ./...` passed in the Linux build container. The real Linux ffmpeg playback-repair regression passed without skipping. A tagged run exposed a thumbnail late-flight race; a deterministic stale-state regression reproduced two renders, then the fixed suite and 20-repeat concurrency check passed. The final full tagged suite passed.

Remaining certification: actual host DNS/TLS renewal, service-user access and separate backup-disk availability; physical iOS/Android background/gesture behavior; Firefox/WebKit and exotic-format fixture matrix; low-resource/large-library budgets, alert thresholds and structured security/operations audit evidence. These require the stated environments and remain in ROADMAP.md. Retained historical failed staging and legacy ghost-account data require operator recovery; these fixes do not silently reassign old private media.

## Original review snapshot

**Original recommendation: hold deployment of the reviewed baseline.** It had confirmed failures in account isolation, upload retention, recovery, and malformed-media handling. Passing the existing suites did not establish safe deployment.

Scope: server infrastructure, CI/release, HTTP authentication and authorization, queue/import/capture, backup/restore/trash, external libraries, media rebuilds, the embedded web application, browser uploads, and dependencies. Reviewed HEAD `4562e19b0706f9ace311322b341e96402d9b3102` **plus the existing uncommitted Trips work**. This is a checkout review, not certification of a running production host or a published image digest. No production implementation or operator library was changed.

P1 means fix before deploying the affected capability. P2 means an important reliability or hardening issue. Findings labeled **reproduced** used disposable fixtures, temporary Go overlays, isolated browsers, or scratch copies of the current implementation. **Code-confirmed** means the failure follows from the inspected path but its full deployed scenario was not executed. Advisory reachability is static analysis, not proof of every advisory's exploitability in the selected deployment topology.

## Original findings requiring deployment to be held

### 1. P1 — A malformed upload can crash the import worker and repeatedly crash the server

**Reproduced.** The TIFF signature branch permits a two-byte input and then reads its third and fourth bytes. The classification call runs in the background queue worker, outside HTTP panic recovery. A validly authenticated web or device user can therefore submit malformed media that panics the process. The running job is requeued at startup, so the same staged file can crash the next process again.

Source: [capability.go:130](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/media/capability.go#L130), [queue.go:204](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/queue/queue.go#L204).

A disposable classification probe caught the index-out-of-range panic for truncated TIFF prefixes. Require the complete signature length before indexing; fuzz short/truncated signatures and contain unexpected per-job panics as durable failed jobs so one item cannot take down the service.

### 2. P1 — First-run setup can overwrite an administrator after setup has completed

**Reproduced.** Setup checks whether an account exists before reading the request body and hashing the password. Its later transaction neither rechecks that setup is still open nor restricts updates to an unclaimed account. A request started before legitimate setup can finish afterward and replace the administrator's password, or create an additional administrator.

Source: [auth.go:47](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/auth.go#L47), [auth.go:325](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/auth.go#L325).

The probe delayed one setup body, completed legitimate setup, then released the delayed request: both returned 201, and the delayed request's password subsequently logged in with 200. Make the setup claim atomic, with a transactional condition that permits exactly one claimant; return 409 to a losing request. First-run setup also needs bounded request size, duration, and concurrency.

### 3. P1 — Import failures and cancellation discard staged uploads

**Reproduced.** Per-file storage/import errors are returned in `Result.Errors`, but the queue marks the overall job succeeded and removes its entire staging directory. The retry path only handles a top-level importer error. The same unconditional cleanup can occur after cancellation, even when the cancelled database update failed and the job remains running.

Source: [queue.go:278](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/queue/queue.go#L278), [queue.go:283](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/queue/queue.go#L283), [queue.go:299](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/queue/queue.go#L299).

A simulated failed storage write produced `succeeded`, zero imports, one file error, and no staged source. Cancellation during a write also removed the source while leaving the job running. The browser has already dropped its local queued file after the server's 202 acknowledgement, making these failures unrecoverable without the user's source copy. Retain unimported files, distinguish permanent admission failures from retryable failures, and commit recoverable job state before removing any source.

### 4. P1 — Device uploads resolve the wrong library owner

**Reproduced for the capture-worker path; code-confirmed for multipart device uploads.** Capture completion places the owner's UUID into a queue field that the worker treats as a username. The importer creates a new placeholder account whose username is that UUID, and imports the media into that account. A queued receipt therefore does not mean the asset reached the user's library.

Source: [capture.go:381](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/capture.go#L381), [queue.go:278](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/queue/queue.go#L278), [importer.go:788](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/importer/importer.go#L788).

Separately, `/api/assets` accepts device principals but obtains ownership only from a session cookie. Bearer-only uploads pass an empty owner name into the queue and select the importer's default account. Source: [upload.go:37](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/upload.go#L37).

Use authenticated owner IDs throughout ingestion; keep CLI username resolution at the CLI boundary. Test session and device uploads through the running worker, asserting both the resulting `assets.owner_id` and visibility in that principal's library.

### 5. P1 — Backup finalization errors are ignored, allowing corrupt backups to count as successful

**Reproduced.** Archive creation defers tar, gzip, and file closing without checking their errors. It returns success before the final compressed output is flushed. A final write failure can leave a truncated archive, record an `ok` backup, and permit pruning of older usable archives.

Source: [backup.go:72](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L72), [schedule.go:50](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/schedule.go#L50), [maintenance.go:127](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/maintenance/maintenance.go#L127).

A scratch process limiting output to 128 bytes observed `Create` return nil; restoring the resulting archive failed with unexpected EOF. Write a temporary archive, explicitly finalize tar/gzip/file with checked errors, sync and atomically publish it, then record success and prune.

### 6. P1 — A successful live backup can omit originals referenced by its database snapshot

**Reproduced.** SQLite is snapshotted before the filesystem walk. Originals are immutable in content, but trash operations move them and purge removes them. A concurrent trash operation can therefore leave an active snapshot row pointing to `originals/...` while the archive contains the bytes only under `trash/...`, or no longer contains them at all.

Source: [backup.go:48](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L48), [backup.go:118](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L118), [trash.go:48](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L48).

A deterministic scratch hook moved an original immediately after the snapshot: both backup and restore returned nil, yet the restored active asset's original path was missing. Coordinate destructive/moving operations with backup, package files according to the snapshot's references, and verify reference completeness before success.

### 7. P1 — Retention purge can remove an asset after the user successfully restores it

**Reproduced.** Expired trash is listed into memory, then purged later. A restore between these steps does not invalidate the purge target. The purger removes derivatives and deletes the asset row unconditionally, even though it is now active.

Source: [trash.go:137](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L137), [trash.go:165](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L165), [trash.go:180](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L180).

The controlled interleaving returned successful restore, followed by a purge that removed the active row and left the restored original orphaned. Serialize or durably claim trash transitions, revalidate eligibility under that protection, and preserve an operation journal across failures. An extra initial `deleted_at` check alone leaves the same race.

### 8. P1 — Activity exposes another user's import jobs and filenames

**Reproduced.** Neither job-list nor job-detail SQL is owner-scoped. Every authenticated session or device can list other accounts' job IDs and read their per-file errors, including private filenames and potentially server paths in errors.

Source: [jobs.go:29](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/jobs.go#L29), [jobs.go:59](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/jobs.go#L59), [jobs.go:71](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/jobs.go#L71).

An Alice session received 200 for Bob's job detail and Bob's private filename. Give jobs a canonical `owner_id`, backfill it safely, constrain list/detail queries to the principal, and extend isolation tests beyond assets/albums.

### 9. P1 — External-library containment can expose another owner's originals

**Reproduced for ancestor roots; code-confirmed for file symlinks.** The creation guard rejects a root inside the data directory but accepts an ancestor of it. Scanning that ancestor descends into the managed library and indexes other owners' originals as the administrator's assets. Media-named file symlinks are also opened without a per-file managed-storage exclusion.

Source: [external.go:84](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/external.go#L84), [external/external.go:37](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/external/external.go#L37), [external/external.go:65](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/external/external.go#L65).

A disposable parent-directory scan returned 201 and created an admin-owned asset referencing another owner's managed original. Reject overlapping roots or prune the managed subtree during traversal; resolve and validate each indexed file and define a safe symlink policy. This violates the documented rule that account administration does not grant access to other libraries.

### 10. P1 — Browser upload queues can send one account's photos into another account

**Reproduced with the actual queue module in an isolated browser and mocked upload endpoint.** A drain captures an owner ID once, but each request uses the current shared session cookie. Signing out and signing in as another user, including in another tab, does not cancel or bind the existing drain. The service worker has the same gap after its initial `/api/me` check.

Source: [upload-queue.ts:156](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/lib/upload-queue.ts#L156), [service-worker.ts:75](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/service-worker.ts#L75), [service-worker.ts:104](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/service-worker.ts#L104), [layout:184](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/routes/+layout.svelte#L184).

Two files stored under owner A were drained with request cookies A then B; both were counted sent and removed from A's queue. Bind each upload to an expected owner that the server validates against the principal, and stop/release active drains on identity changes. A client-side owner check alone cannot eliminate a cookie-change race between checking and sending.

### 11. P1 — The selected Go toolchain has known vulnerabilities on used serving/upload paths

**Scanner-confirmed, with primary advisories verified.** `go.mod` selects Go 1.26.6 and this review used that version. `govulncheck` reported ten advisory IDs with reachable standard-library symbols, plus other module/package-only notices. The most directly applicable paths are multipart parsing and Range handling; the latter also occurs in public static-file serving.

Source: [go.mod:3](https://github.com/kuraki-app/kuraki/blob/0796be3/go.mod#L3), [upload.go:27](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/upload.go#L27), [router.go:303](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/router.go#L303).

[GO-2026-6608](https://pkg.go.dev/vuln/GO-2026-6608) concerns multipart memory-limit bypass; [GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609) concerns excessive CPU from Range parsing. Both list Go 1.26.9 as the fixed version. Raise the selected supported patch version and rebuild all release artifacts; rerun symbol-level scanning. HTTP/2-related scanner results require topology-specific triage because the provided Caddy deployment terminates TLS and proxies to an HTTP listener. The floating Docker build tag may already resolve a newer patch: an actual built/published digest must be scanned before drawing conclusions about that image.

### 12. P1 — Plain-HTTP LAN deployment breaks browser uploads

**Browser-confirmed prerequisite failure.** Every selected file is first persisted through a queue that unconditionally calls `crypto.randomUUID`. That method is restricted to secure contexts. The documented LAN URL is ordinary HTTP, so the upload throws before a request reaches the server.

Source: [upload-queue.ts:96](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/lib/upload-queue.ts#L96), [docker-compose.yml:29](https://github.com/kuraki-app/kuraki/blob/0796be3/docker-compose.yml#L29).

An isolated Chromium-family browser at an ordinary HTTP hostname reported `isSecureContext=false`, `crypto.randomUUID=undefined`, and a working `getRandomValues`. Provide a queue-ID fallback usable over the supported HTTP mode, or make HTTPS a requirement and align installation instructions. Keep an ordinary LAN-origin regression; localhost is treated specially and masks this bug. The restriction is specified by the [Web Cryptography API](https://w3c.github.io/webcrypto/#Crypto-method-randomUUID) and documented in [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID).

### 13. P1 — Publishing a release does not wait for verification

**Code-confirmed.** CI and Release independently start on version tags. Release builds and publishes images; its manifest job depends only on the image build. Failing race, contract, web type, browser, or tagged-media tests in CI cannot stop it advancing `latest`.

Source: [release.yml:16](https://github.com/kuraki-app/kuraki/blob/0796be3/.github/workflows/release.yml#L16), [release.yml:158](https://github.com/kuraki-app/kuraki/blob/0796be3/.github/workflows/release.yml#L158), [release.yml:179](https://github.com/kuraki-app/kuraki/blob/0796be3/.github/workflows/release.yml#L179).

Make publishing depend on required verification for the same commit. Add artifact-level startup/setup/import/restart/restore smoke tests, plus dependency and container scanning. An image that builds has not yet demonstrated it can run and recover.

### 14. P1 — The documented Docker restore command cannot complete

**Code-confirmed; exact Linux-container execution unavailable.** The guide mounts the restore destination itself at `/restore`. Restore creates a temporary sibling under `/`, which the image's UID 10001 cannot write. Even with different permissions, the subsequent replacement tries to rename the bind-mount point itself.

Source: [RUNNING.md:490](https://github.com/kuraki-app/kuraki/blob/0796be3/RUNNING.md#L490), [backup.go:186](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L186), [backup.go:326](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L326).

Mount a service-writable parent directory and restore into an absent child, then point the normal data mount at that child. Rehearse the exact documented command using the shipped non-root image.

## Additional reliability and security findings

### 15. P2 — Restore accepts a missing gzip integrity trailer

**Reproduced.** Restore stops at tar EOF without reading gzip through its own EOF. Closing a gzip reader does not validate unread CRC/length bytes. Removing the final eight bytes from a valid archive still produced successful restore in a scratch probe.

Source: [backup.go:218](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/backup/backup.go#L218).

Drain the gzip reader and propagate checksum/truncation errors before installation. Aggregate manifest counts do not substitute for compression integrity, SQLite validity, or referenced-original completeness.

### 16. P2 — Trash and restore have an unreconciled crash window

**Code-confirmed.** Both operations move the original before changing database state. The attempted rollback only runs on a returned error; abrupt process death leaves active/deleted state inconsistent with the filesystem. No startup reconciliation for that transition was found.

Source: [trash.go:48](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L48), [trash.go:79](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L79).

Persist recoverable intents and reconcile them, or keep soft-deleted originals at stable paths and move only when the product's retention design requires it. Test process interruption at each transition boundary.

### 17. P2 — Rebuild can report success while a required preview is still missing

**Reproduced.** The initial preview makes the stored asset `web_viewable`. Rebuild reuses that stored flag as if it described the original's codec/format; `createPreview` immediately returns without regenerating it. Rebuild can advance generation and clear the issue while retaining a missing preview path.

Source: [importer.go:521](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/importer/importer.go#L521), [importer.go:653](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/importer/importer.go#L653), [importer.go:680](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/importer/importer.go#L680).

A disposable non-browser-original fixture reproduced success after its preview file was removed. Re-probe original capability and verify every required derivative before clearing health issues; distinguish original compatibility from compatibility supplied by a derivative.

### 18. P2 — Manual maintenance endpoints bypass bounded worker ownership

**Code-confirmed.** Each rebuild starts a detached background goroutine and copies its original into temporary storage. There is no per-asset coalescing, bounded queue, or lifecycle context. Manual integrity likewise launches a whole-library verification for each request, and its route is session-only rather than admin-only even though the verifier scans every owner.

Source: [media_health.go:92](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/media_health.go#L92), [integrity.go:37](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/integrity.go#L37), [verify.go:70](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/verify/verify.go#L70).

Repeated valid requests can exhaust CPU, memory, disk, and media subprocess capacity, and concurrent rebuilds race derivative generation. Route these operations through bounded application-owned jobs, coalesce repeated work, apply the intended authorization, and join/cancel them at shutdown.

### 19. P2 — Recomputing an instant-span Trip breaks stable identity

**Reproduced in the current uncommitted feature.** `claimTrip` rejects zero time overlap before reaching its instant-span guard. A qualifying group whose photos share one timestamp cannot reclaim its existing trip. Naming that trip and recomputing can create a second trip with the same photos while preserving the named old row.

Source: [trips.go:418](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trips/trips.go#L418), [trips.go:427](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trips/trips.go#L427).

An eight-photo away-from-home fixture with identical timestamps reproduced the duplicate after naming and recomputation. Match equal instants before rejecting overlap, and test stable trip IDs and membership after repeated detection and metadata changes.

### 20. P2 — Web dependency advisories need remediation and reachability triage

**Registry-confirmed.** The locked dependency graph produced ten npm audit entries: two high, two moderate, and six low. These counts include dependency-chain effects, not ten distinct exploitable application vulnerabilities. Locked packages include `devalue` 5.8.1, `source-map-js` 1.2.1, `vitest`/`@vitest/mocker` 4.1.10, and `cookie` 0.6.0.

Source: [package-lock.json](https://github.com/kuraki-app/kuraki/blob/0796be3/web/package-lock.json).

The maintainer's [devalue advisory](https://github.com/sveltejs/devalue/security/advisories/GHSA-j22f-vq7h-c4qm) fixes shared-memory serialization in 5.9.3; the [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) fixes a mock-server file-read path in 4.1.11; [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) fixes indexed-map CPU denial of service in 1.2.2. This deployment uses a static SPA served by Go: Node SSR and Vitest servers are not production services, so those server-side attacks are not established production exposures here. Update compatible patches, assess remaining transitive advisories, and scan production artifacts instead of blindly applying major-version audit fixes.

### 21. P2 — JSON request bodies lack endpoint-appropriate size and read bounds

**Code-confirmed.** Upload routes have byte limits, but credential and ordinary JSON handlers decode request bodies without `MaxBytesReader`. The server sets a header timeout and an idle timeout, but no request-body read timeout. Request-context timeout alone does not impose a socket read deadline on a handler blocked reading a body.

Source: [auth.go:57](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/auth.go#L57), [auth.go:107](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/auth.go#L107), [app.go:489](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/app/app.go#L489).

Large credential strings or slow body delivery consume resources disproportionate to these small operations; setup lacks login's rate limiter. Apply small JSON limits, bounded credential fields, and read deadlines appropriate to JSON versus large media streams. Preserve streaming exports/SSE and use route-specific upload policy. See the [Go server timeout contract](https://pkg.go.dev/net/http#Server).

### 22. P2 — External assets do not consistently use their external source in lifecycle operations

**Code-confirmed.** External scanning stores an `external_path` and a synthetic `original_path`. The verifier and derivative rebuilder open the synthetic path under managed `originals/`, and ordinary trash tries to move it. These paths fail for a correctly indexed external asset rather than reading its actual source. The thumbnail service already models external paths; the other consumers need equivalent source resolution.

Source: [external/external.go:65](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/external/external.go#L65), [verify.go:70](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/verify/verify.go#L70), [importer.go:635](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/importer/importer.go#L635), [trash.go:48](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/trash/trash.go#L48).

Use one source-resolution policy for media and verification. External soft deletion should update catalog state while respecting the source's read-only contract. Add coverage for an indexed asset's verification, rebuild, trash/restore, export, and unavailable/remounted source behavior.

## Other configuration and evidence gaps

- **Fresh Linux bind mounts need provisioning.** The image runs as UID/GID 10001. The longer guide mentions ownership preparation, but the root Compose instructions and short deployment procedure omit it. A Docker-created root-owned data directory can fail application initialization; the separate backup mount has the same prerequisite. Add permission preflight and provisioning to the actual quick-start commands. Check the resolved Compose paths: relative paths in `deploy/docker-compose.caddy.yml` are relative to that Compose file's directory.
- **Disabled-account login reports success.** A disposable probe confirmed `/api/login` returns 200 and creates a session for a disabled user because its lookup omits `disabled_at`. Subsequent authenticated requests reject the user, so this is not a demonstrated authorization bypass, but it gives misleading sign-in success and stores useless sessions. Reject disabled accounts during login. [auth.go:114](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/auth.go#L114).
- **The web sync cursor is shared across accounts.** `kuraki:sync-cursor` is per origin, while the feed is per owner. Account switching or a restored library with a lower change-log head can suppress refresh until IDs exceed the previous cursor; the server only resets cursors below its retained floor. Key cursors by library and owner and handle a cursor ahead of the current head. [sync.ts:22](https://github.com/kuraki-app/kuraki/blob/0796be3/web/src/lib/sync.ts#L22), [changes.go:109](https://github.com/kuraki-app/kuraki/blob/0796be3/internal/httpapi/changes.go#L109).
- **Operational endpoints remain broader than their labels imply.** Backup/integrity status is server-wide but available to ordinary sessions; the backup summary includes the destination path. Define which server-wide operational details and actions require administration, and test that policy across every route.
- **Deployment evidence is incomplete.** No production URL, target-host configuration, reverse-proxy runtime, or published image digest was supplied. Docker runtime verification was unavailable. TLS renewal, actual forwarded-header behavior, filesystem ownership, backup disk availability, and startup/restore on the shipped image remain deployment checks.
- **Release certification remains open.** The advertised media-format matrix, Firefox/WebKit media behavior, physical iOS/Android backup behavior, 10k/50k/500k budgets, WAL/disk growth, isolated clean-machine restores, alert thresholds, and systematic security/operations audit events still need evidence. These are separate from the confirmed implementation defects.
- **The older readiness audit is a historical baseline.** Docker now builds with `-tags vips`; web/mobile tests, security headers, migration regression tests, and authenticated metrics exist. Do not carry those older absence claims forward. CI's Docker job still proves buildability rather than artifact startup/recovery.

## Original validation performed

| Check | Result / practical limit |
| --- | --- |
| Go build and vet | Passed with the current pure-Go default. |
| Go race suite | All project packages passed. One migration-client package initially could not bind its temporary test server inside the sandbox; rerunning that package with local-listener permission passed. |
| Web type check | Zero errors and zero warnings. |
| Web unit tests | Five files, 29 tests passed. |
| Web production build | Passed in a temporary source copy; the existing embedded assets were preserved. Build relocation was not used as proof of byte-identical committed assets. |
| Web static size budgets | Initial JS/CSS, largest lazy chunk, and font budgets passed. |
| Browser suite | 120 of 121 passed on the current embedded UI using isolated headless Brave/Chromium. The remaining PWA test failed because its text locator matched both a queue indicator and a toast. A temporary test copy using exact text matching subsequently passed setup and both PWA tests (3/3), including offline → reconnect → accepted upload. The repository test remains unchanged; repair its ambiguous selector before relying on an all-green CI result. |
| Targeted Go probes | Setup overwrite, job isolation leak, disabled sign-in, capture-owner mismatch, failed/cancelled upload cleanup, external ancestor overlap, missing-preview rebuild, instant-span Trip identity, purge/restore race, and short media signatures were reproduced on disposable fixtures. |
| Targeted backup probes | Archive-finalization false success, snapshot/filesystem mismatch, and missing gzip trailer acceptance were reproduced using scratch copies of current code. |
| Targeted browser probes | Ordinary HTTP lacks the queue's required UUID method; actual queue code sent stored owner-A files with A then B cookies after an account change. Mocked upload endpoint used; no private media sent. |
| Dependency scans | npm registry audit and official Go symbol-level vulnerability scan completed. No container/system-package scan or tagged-libvips runtime certification performed. |

## Original recommended remediation order

1. Contain malformed-media crashes; atomically close first-run setup; upgrade the vulnerable Go patch.
2. Establish canonical owner IDs across ingestion, job reads, and browser uploads; close external-source containment.
3. Retain failed/cancelled staged files and serialize trash transitions; test recovery after process interruption.
4. Make archive creation/finalization and snapshot-file capture reliable; verify full archive integrity and rehearse Docker restore.
5. Make release publication depend on the verification above. Complete bounded maintenance, external lifecycle, preview rebuild, web dependency, and LAN-upload work before certifying those capabilities.

Deployment acceptance should demonstrate these failure-path regressions plus a startup → setup → web/device import → restart → backup → isolated restore → integrity verification flow using the exact release artifact. Current test success alone is insufficient.
