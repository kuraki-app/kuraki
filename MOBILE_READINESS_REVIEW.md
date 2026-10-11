# Android and iOS readiness review — 11 October 2026

Reviewed merged server hardening at `079f119d197f34a797072129511737c405fb761f`.
This is a mobile follow-up on `codex/mobile-readiness-review`. Application code
has not been changed. The assessment covers capture, local deletion, account
changes, offline state, background work, native packaging, and performance.

**Recommendation: fix backup/deletion safety and account isolation before a mobile
release.** Static checks passing does not establish that a phone's current media
is safely present in its currently selected server library.

## What actually ran

| Check | Result and limit |
| --- | --- |
| TypeScript and Expo lint | Passed against unchanged application source. |
| Existing mobile suite | 288 tests across 38 files passed. It primarily tests pure logic; it does not drive the native backup engine or signed apps. |
| Targeted defect probes | Nine unsafe outcomes reproduced across three temporary test files, using actual engine/API/settings/session functions with mocked native storage/media/network boundaries. No real photograph was deleted. |
| Production JS bundles | Android and iOS Hermes exports succeeded from the current checkout. This proves bundling, not device execution. |
| Native iOS generation/build | Fresh isolated prebuild, 120 CocoaPods dependencies and Xcode simulator build succeeded on iOS 26.5. |
| iOS runtime | The existing build failed against current JS with native Worklets 0.8.3 versus JS 0.10.1. Rebuilding removed that stale dependency setup, but the unsigned/ad-hoc test build then encountered missing keychain entitlements; subsequent test entitlement signing was rejected by the simulator. Full current-app pairing/browsing was not certified. Those signing failures are test-environment limitations, not evidence of a signed release crash. |
| Android runtime | A read-only Pixel_10_Pro emulator on Android 37.1 installed and launched the available APK. It displays the older Backup/Library/Settings interface, rather than the current four-tab app. The optional APK is dated 13 July, version 1.0.0/code 1/target 36; it cannot certify current source. |
| Fresh Android native build | Native generation inspected separately; compilation could not be certified because the host has no Java runtime. No physical Android device was attached. |
| Expo compatibility | `expo install --check` flagged 14 packages for supported patch updates, including Expo, router, background task, task manager, SQLite and video. |
| Dependency audit | Registry audit reported 40 affected package entries: 1 critical, 25 high, 14 moderate. This includes transitive development/build tooling and is not proof of 40 exploitable on-device vulnerabilities. |

Reproduce the nine observed defects with:

```sh
bash mobile/audit/2026-10-11/run-probes.sh
```

**Passing this historical probe suite means the observed defective behavior still
exists.** It is deliberately outside the normal regression suite. The runner
refuses to overwrite existing files and removes its temporary tests on exit.
After remediation, convert the affected cases into assertions of correct behavior.

## Confirmed defects

### 1. P1 — Local deletion trusts a queued upload rather than a verified server original

Both platforms. `uploadFile` returns the capture completion receipt (usually
`status: queued`), and `backupOne` immediately calls `markBackedUp`. Free up space
uses that historical ID set offline, without verifying the import succeeded,
the current server still holds the original, or the current local bytes match it.
The probe returned a queued-only receipt: the engine recorded one completed backup
and offered that photo for reclamation before import.

Sources: [backup-engine.ts](mobile/src/lib/backup-engine.ts),
[capture-api.ts](mobile/src/lib/capture-api.ts),
[reclaim.ts](mobile/src/lib/reclaim.ts),
[Free up space](<mobile/src/app/(app)/settings/free-up-space.tsx>).

The hardened server retains failed staging, but staging is not a confirmed catalog
original and is excluded from portable backups. A later server purge or a local
edit also invalidates a historical receipt. iOS Recently Deleted is an additional
recovery window, not evidence that permanent removal is safe. Require a durable
successful import receipt with server asset/content identity, and revalidate the
current original before offering local removal. Fail closed when it cannot be
verified; legacy ID-only receipts cannot justify deletion.

### 2. P1 — Backup history and resumable sessions are shared across libraries

Both platforms, reproduced. `kuraki-backup.db` keys both tables only by `local_id`.
Changing server/token clears the disposable mirror but not this ledger or the
singleton engine's in-memory `done` set. The probe backed up a photo to A, switched
to B and simulated a fresh process: B reported one completed backup while receiving
no upload. Resumable session IDs also belong to the old server/account.

Sources: [backup-ledger.ts](mobile/src/lib/backup-ledger.ts),
[settings.ts](mobile/src/lib/settings.ts), [backup-engine.ts](mobile/src/lib/backup-engine.ts).
Scope receipts and sessions by verified library identity; stop/drain an old pass
before changing credentials. Re-pairing the same owner should retain valid receipts
without treating another owner as that library. Historical unscoped records need
explicit safe migration rather than assumed ownership.

### 3. P1 — An old request can repopulate another account's offline cache

Both platforms, reproduced through `fetchLibrary` and `saveCaptureSettings`.
The new credentials are stored and the mirror is cleared, but old HTTP requests
and deferred cache writes are not fenced by identity/generation. A delayed A response
arrived after switching to B and wrote A's private filename/asset back into B's mirror.
A second probe cleared token A before re-pairing B at the same address: because
`switchedLibrary` requires a nonempty previous token, no reset happened and A's
mirror remained. Revocation/re-pair and restored Android app data are additional
identity transitions to cover. The delayed-write seam also exists in delta sync
and album/tag reads. Mounted screens also commonly
retain settings read once at mount.

Sources: [library-api.ts](mobile/src/lib/library-api.ts),
[settings.ts](mobile/src/lib/settings.ts), [reset.ts](mobile/src/lib/cache/reset.ts).
Add a serialized identity transition, cancel/fence old requests and writes, and
update mounted consumers through a shared reactive connection identity. Consider
separate library-scoped caches instead of a global cache with a best-effort reset.

### 4. P2 — The singleton backup guard permits overlapping runs

Both platforms, reproduced. `run` checks `running` before awaiting credentials,
permission and network state; it sets `running` afterward. Two simultaneous calls
both pass that check and upload the same photo. One pass can clear the other's
running/controller state; Stop then has ambiguous ownership. Server deduplication
limits duplicate catalog assets, but not redundant traffic or broken cancellation.

Source: [backup-engine.ts](mobile/src/lib/backup-engine.ts).
Claim a single-flight run before the first asynchronous preflight and release it
in one outer `finally`; serialize initialization and settings changes as well.

### 5. P2 — Wi-Fi-only protection is not maintained during a pass

Both platforms, reproduced. `currentConnection` is read once before scanning the
entire camera roll. The three-file probe observed three uploads and only one network
read. A switch to cellular during a long pass can continue uploading. Unknown/VPN
connections are also allowed intentionally, so the current label is stricter than
the actual policy.

Sources: [backup-engine.ts](mobile/src/lib/backup-engine.ts),
[network-policy.ts](mobile/src/lib/network-policy.ts).
Recheck policy during files/chunks and subscribe to connection changes, aborting
and preserving offsets when disallowed. Define conservative handling of unknown
or metered connections and explain the policy accurately. Network reconnection
should trigger a bounded resume rather than waiting solely for AppState/OS wakes.

### 6. P2 — An old 401 flags a newly paired device as disconnected

Both platforms, reproduced. `clearDeviceToken(failedToken)` protects the new stored
token, but `reportAuthLost` sets the process-wide `lost` flag and notifies subscribers
before that comparison. The probe retained token B while a failed token A request
set `isAuthLost()` to true. UI state and notifications contradict valid credentials.

Source: [session.ts](mobile/src/lib/session.ts).
Associate the rejected request with the active identity before changing any state
or notifying; make the credential comparison/clear atomic with pairing writes.

### 7. P2 — Trip pages show the unfiltered library

Both platforms, reproduced at the request boundary. `LibraryFilters` includes
`trip` and TripGrid passes it, but `fetchLibrary` never adds it to the query string.
The observed request was `/api/search?` rather than a trip-filtered query.

Source: [library-api.ts](mobile/src/lib/library-api.ts).
Serialize the trip filter and test the actual outgoing URL and distinct memberships.

### 8. P2 — Trip loading failures escape without usable recovery UI

Both platforms, code-confirmed. TripGrid's initial `load` has only `finally` and
is called through bare `void load()`; pagination has neither error handling nor an
in-flight guard. Offline/server failures become unhandled rejections, while repeated
end-reached callbacks can append the same page twice. Successful empty responses
and failed responses should have separate messages and a retry action.

Source: [TripGrid](mobile/src/components/trip-grid.tsx).
Add error/retry state, request cancellation/generation fencing and guarded pagination.

### 9. P2 — A conflict with no offset can cause a zero-progress upload loop

Both platforms, reproduced through the actual `uploadFile` implementation.
`Number(response.headers.get('Upload-Offset'))` turns an absent header into zero,
and the 409 handler accepts an offset equal to the current offset. Three zero-progress
PATCHes occurred with no backoff before the probe explicitly aborted the loop.

Source: [capture-api.ts](mobile/src/lib/capture-api.ts).
Require a present, valid advancing receipt; bound corrective attempts and treat
non-offset conflicts as failures. A completed-byte resume should retry completion
rather than rejecting `offset == size` and resending a multi-gigabyte file.

### 10. P2 — Stop and task expiration do not cover the whole operation

Both platforms, code-confirmed. The AbortSignal is passed to chunk PATCHes, but not
source fallback reads, capture start/completion, iCloud asset resolution or delta
sync. Task expiration only calls `backupEngine.stop`; if expiration happens during
the earlier sync, backup can start afterward with a new controller. Reads have no
client deadline, and the 20-page sync bound can still make thousands of serial calls.

Sources: [background.ts](mobile/src/lib/background.ts),
[background-sync.ts](mobile/src/lib/background-sync.ts),
[capture-api.ts](mobile/src/lib/capture-api.ts), [library-api.ts](mobile/src/lib/library-api.ts).
Use one deadline/cancellation owner for the entire wake, check expiration before
starting the next phase, propagate signals and persist a bounded continuation.

### 11. P1 release gate — Mobile dependencies need their own remediation and triage

Registry results include critical `shell-quote` command injection in build tooling,
high `source-map-js` resource exhaustion and additional XML/signature/toolchain
advisories. Many reported entries are propagated dependency chains. The registry's
suggested Expo/RN downgrades are not a safe compatibility plan.

Sources: [mobile lockfile](mobile/package-lock.json), [verification workflow](.github/workflows/verify.yml).
Align supported Expo 57 patch versions, apply compatible leaf fixes, verify actual
tool/runtime reachability and rebuild native binaries. Add mobile audit/compatibility
gates: the current npm audit gate covers web only. Rescan the resulting lockfile and
signed artifacts. No claim is made that these advisories expose private photos remotely.

### 12. P2 release gap — Native artifacts and automation do not certify current source

The existing Android APK is older than current navigation/background/security work;
the existing iOS binary demonstrated an incompatible Worklets native version. EAS
development configuration requests `developmentClient: true`, but the dependency
list lacks `expo-dev-client`. Expo's [development-build setup](https://docs.expo.dev/tutorial/eas/configure-development-build/)
requires that library for the documented development client experience.

Sources: [eas.json](mobile/eas.json), [package.json](mobile/package.json),
[release checklist](mobile/RELEASE_CHECKLIST.md).
Build/version/sign both platforms from the reviewed commit, pin an installable APK
delivery profile and checksum/provenance, and gate releases on installed-app flows.
The current shared CI does not build or drive Android/iOS native apps. AAB store
packages and direct-install APKs serve different delivery paths; internal preview
builds can produce APKs, but neither is coupled to the server's optional download.
The old optional local APK was inspected and preserved, not replaced or published.

## Additional platform gaps and optimization priorities

1. **Android non-file sources:** `openSource` buffers an entire `content://`/remote
   source into a Blob. This does not have the file-handle path's bounded-memory
   guarantee. Test document-provider and multi-gigabyte sources, then spool/read
   bounded native chunks instead of buffering the whole object.
2. **Large camera rolls:** `collectNewAssets` walks every page and builds the entire
   pending array before the first upload. Foreground passes may repeat every minute.
   Stream bounded pages, persist a continuation, batch ledger writes and measure
   startup delay, memory and battery at realistic library sizes.
3. **Changed local media:** ID-only receipts cannot distinguish an edited/replaced
   local item from previously backed-up bytes. Track modification/content identity;
   this matters especially before local reclamation.
4. **iOS Live Photos:** asset info exposes a paired video, but `resolveUri` consumes
   only the still's URI. Motion-component backup/replay is not established by the
   current implementation. Define and test the contract before promising complete
   Live Photo preservation; include iCloud/offloaded variants.
5. **Permission scope:** the APK and default camera/media plugins declare audio
   read/record permissions even though backup selects photo/video and camera use is
   QR scanning. Limit generated permissions and runtime requests to needed media;
   test Android 13+ selected-photo access and denied-audio combinations, plus iOS
   limited-library additions/removals.
6. **Startup recovery:** `isSetupComplete().then(setReady)` has no failure handler.
   The unsigned test build's rejected keychain read left a blank app. This does not
   prove failure of a correctly signed release, but the I/O failure path needs an
   explicit retry/error state. Also catch optional native notification/cache failures.
7. **UI performance:** grid virtualization and bounded thumbnail workers already
   exist. Profile JS-thread gesture work, image decode/cache pressure, native video
   lifecycle, dynamic type, low-memory Android and older iPhones before changing
   libraries. No measured frame-rate or battery improvement is claimed by this audit.

## Platform acceptance still required

Fix findings 1–3 first; then serialize backup, enforce networking/cancellation,
repair UI/protocol behavior, remediate dependencies and build current signed artifacts.
Exercise full/limited/denied permissions, pairing/revocation, account switching,
offline mutations, image/video viewing, deletion/recovery, edited media, large videos,
process death and task expiration on both platforms.

Physical devices remain necessary for scheduling, locked-device credentials,
iCloud, Android vendor battery restrictions, biometric/keychain behavior and
release signing. Expo documents that iOS background tasks are unavailable in
simulators and both operating systems choose when work runs:
[Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/).
Native/JS Worklets versions must match and changing native versions requires a
rebuild: [Worklets troubleshooting](https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting/).
Simulator/emulator success must not be presented as that physical-device evidence.
