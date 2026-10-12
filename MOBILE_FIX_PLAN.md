# Mobile hardening plan

Branch: `codex/mobile-hardening`, starting at audit `8f84b36`. Scope: all twelve
findings and the additional platform gaps in MOBILE_READINESS_REVIEW.md. Commit
substantial milestones; update the ledger/handoff and evidence in each milestone.

## 1. Verified backup and library isolation

- [x] Add authenticated server/library identity, durable import-to-original receipts
      and owner-scoped content verification; preserve pure-Go/append-only invariants.
- [x] Scope mobile backup receipts/resumable sessions by library; retain legacy data
      for recovery without treating unverified IDs as deletion permission.
- [x] Serialize credential transitions; fence/cancel old work, scope cache databases
      and refresh mounted consumers. Ignore old-token failures after re-pairing.
- [x] Revalidate local content and current server originals immediately before local
      reclamation; require complete still/motion receipts for Live Photos.
- [x] Convert the actual public-boundary audit reproductions into correct-behavior
      regressions, including queued/failed import, purge, edits and identity changes.

## 2. Bounded backup, networking and UI

- [x] Single-flight initialization/run and ownership of cancellation/deadlines.
- [x] Stream camera-roll pages and non-file sources with bounded memory; resume
      completed-byte sessions without resending originals.
- [x] Enforce Wi-Fi policy through a pass and resume on reconnect; propagate task
      expiration through sync, resolution, upload start/chunks/completion.
- [x] Validate advancing upload receipts and bound conflict recovery/retry loops.
- [x] Serialize trip filters; guard pagination, stale requests and offline retry UI.
- [x] Handle startup/optional-module I/O failures with usable recovery state.

## 3. Dependencies, permissions and native release evidence

- [x] Align Expo patches and remediate mobile advisories; add compatibility/audit
      gates without speculative framework downgrades.
- [x] Narrow photo/video/QR permissions and document limited/cloud/Live Photo behavior.
- [x] Add development-client and installable artifact profiles, commit/checksum
      provenance and installed-app/native build automation on both platforms.
- [x] Build current native artifacts in isolated environments; exercise available
      simulator/emulator flows and record device/performance/signing limits honestly.

## 4. Review and delivery

- [ ] Full Go/web/mobile checks, contract/UI consistency, native smoke and regression
      suites; standards/spec review against `079f119d` and the mobile audit.
- [ ] Update findings with implemented behavior and evidence, commit major milestones,
      push and create/attach a PR. No release/tag or operator library is deployed.

Physical device scheduling, iCloud and vendor battery behavior require hardware;
implement the correct contracts and automated release gates, then retain the exact
remaining certification requirements. Do not substitute simulator checks for them.
