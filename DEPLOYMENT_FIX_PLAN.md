# Pre-deployment hardening plan

Branch: `codex/pre-deployment-hardening`. Scope: all 22 numbered findings and the configuration gaps in `PRE_DEPLOYMENT_REVIEW.md`. Preserve the reviewed Trips feature as a prerequisite baseline. Commit at substantial milestones, update this checklist and AGENTS.md in each milestone, and open a PR after verification.

## 1. Authentication, isolation, and ingestion

- [x] 1: reject truncated signatures and contain import-worker panics.
- [x] 2: claim first-run setup atomically.
- [x] 3: retain failed/cancelled staged uploads with durable retry state.
- [x] 4: use canonical authenticated owner IDs for session/device ingestion.
- [x] 8: owner-scope import job lists/details.
- [x] 9: exclude managed storage and unsafe symlinks from external scans.
- [x] 21: bound JSON bodies, credential fields, and body read duration.
- [x] Reject disabled-account login; enforce administrative operation policy.

Evidence: `make check` passed, including race tests and HTTP-to-worker capture
completion. Targeted regressions cover the delayed setup claim, account isolation,
credential bounds, short signatures, failed/cancelled source retention, and external
root/symlink exclusion. Migration 00029 backfills job ownership; unresolved historical
jobs remain private. Failed staged files are retained for operator recovery.

## 2. Recovery, storage, and bounded maintenance

- [x] 5: atomically publish only fully finalized archives.
- [x] 6: coordinate snapshot/file capture with destructive operations.
- [x] 7: serialize restore/purge and revalidate retention eligibility.
- [x] 15: verify the complete gzip stream before installing a restore.
- [x] 16: recover interrupted trash/restore transitions.
- [x] 17: derive preview requirements from original capability during rebuild.
- [x] 18: bound, coalesce, and lifecycle-own manual maintenance work.
- [x] 19: keep instant-span Trip identity stable across detection.
- [x] 22: resolve external originals consistently without modifying sources.

Evidence: full `make check` and Windows/amd64 + Linux/arm64 pure-Go builds passed.
Regressions exercise output-finalization failure in a subprocess, gzip truncation,
referenced-original absence, stale retention candidates, interrupted cleanup/legacy
reconciliation, real external asset read/verify/rebuild/export/trash, missing previews,
bounded/coalesced worker cancellation, and repeated instant-span Trip detection.
Migration 00030 journals permanent cleanup. Soft deletion keeps original paths stable;
legacy moved originals reconcile without changing their catalog visibility.

## 3. Web reliability and dependencies

- [x] 10: bind queued uploads to their expected account at the server.
- [x] 12: support queue IDs on the documented plain-HTTP LAN origin.
- [x] 20: remediate/triage npm advisories without speculative major upgrades.
- [x] Scope sync cursors by account/library; reset cursors beyond feed head.
- [x] Fix the PWA assertion and exercise account changes/reconnect in browsers.
- [x] Regenerate committed embedded UI and API clients where needed.

Evidence: web type/build checks, 36 unit tests, size budgets, 15 focused Chromium
tests, and full Go checks passed. The browser uses a real non-secure HTTP hostname
and switches cookies between the first and second queued upload: the second is
rejected and retained for its original account. The updated lockfile reports zero
npm advisories. Server-wide maintenance status is requested/rendered only for admins.

## 4. Deployment and release verification

- [ ] 11: select a patched Go toolchain and rescan reachable symbols.
- [ ] 13: make publishing depend on verification of the same artifact/commit.
- [ ] 14: repair and smoke-test the Docker restore procedure.
- [ ] Add service-account mount provisioning and deployment preflight.
- [ ] Add dependency/container scans and an artifact-level recovery smoke flow.
- [ ] Run Go race/vet/build, web type/unit/build/browser, mobile static tests, contract/UI drift, and tagged-media/container checks when the runtime is available.
- [ ] Update the review with evidence and explicitly retain any hardware/target-host certification limits.
- [ ] Push the completed branch and create/attach the PR.

## Completion criteria

Each fixed defect has a regression at its actual public boundary or an artifact-level check. Supported deployment instructions work with the non-root image. No existing originals or operator data are changed during development. A release cannot be published before required verification passes. Physical-device and target-host evidence must be reported accurately; repository changes cannot substitute for those environments.
