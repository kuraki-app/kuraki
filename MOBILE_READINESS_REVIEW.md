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
[settings.ts](mobile/src/lib/settings.ts), [reset.ts at the audit baseline](https://github.com/kuraki-app/kuraki/blob/8f84b36/mobile/src/lib/cache/reset.ts).
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

## Remediation in progress (2026-10-11)

Original safety/isolation and bounded engine/protocol fixes are implemented on
`codex/mobile-hardening`: findings 1–10 now have regression coverage and corrected
behavior. Receipts require successful import; reclamation checks current local
BLAKE3 bytes and server originals. Availability checks repair purge/restore history.
Libraries have separate credentials/cache/ledger namespaces with fenced stale work.
Live Photos require both still and motion originals. The engine streams pages,
reserves history work and owns cancellation; trip/tag grids handle retry/pagination.
315 mobile tests and the server race suite passed before this milestone. Native
builds, dependency remediation, CI release gates and hardware evidence follow.
The historical probe files above are retained audit evidence, not passing-fix tests.

## Native and review closure (2026-10-12)

All twelve reported implementation findings have fixes. Follow-up review also
closed full-byte pre-completion crash recovery, stalled error-body cancellation,
page-budget starvation and cleanup scan continuation. Manual queued uploads now
continue receipt checks without requiring automatic backup. Mobile security gates
accept only two precise, source-checked local mitigations without upstream releases;
all other advisories fail. Compatible Expo patches and current dev-client are locked.

Fresh standalone Android release APK and iOS simulator app compile successfully.
The Android37.1 QA process launched without native errors. On iOS 26.5 the current
app paired with a disposable server, persisted connection/setup through restart,
browsed native tabs, imported seven simulator test photos (including one generated
PNG), and matched six older local originals through real BLAKE3/server verification.
No local deletion was executed. Permission manifests remove audio while retaining
QR camera access; cold navigation and setup progress accessibility were corrected.

325 mobile regressions, full Go race/vet/format, TypeScript/lint and workflow checks
pass. Native CI now builds and installs each current candidate, exercises pairing,
restart and real backup receipts, and records artifact provenance. Local build
provenance and CI results are recorded separately; these foreground simulator checks
do not replace physical-device locked scheduling, iCloud/Live Photo vendor behavior,
large-library/video battery/RSS measurement or production store signing.

## Final offline ordering review (2026-10-12)

Public API regressions reproduced older offline favorites, tags and album changes
replaying after newer online writes. All offline-capable writes now enter one durable
FIFO before transport, and pushes/pulls are serialized separately per verified library.
Canceled native waits release that lane; a failed send retains the intent once. Saving
an address uses the resolved identity while draining its queue. Thirteen real-SQL/HTTP and
cancellation regressions bring the mobile suite to338 tests; the browser suite passes
124 tests. PR36 tracks current CI results and native artifact provenance. The first
native Android CI attempt exposed a removed SDK tools package; its setup now requests
platform-tools explicitly. No application rollback or older binary is used as evidence.

Foreground metadata recovery also runs when automatic photo backup is off. Its
ordered queue drains at most500 rows in bounded100-row pages, under a30-second
pass deadline. Native iOS CI warms its cold test driver before generating pairing
codes; its driver startup has an explicit budget and anonymous analytics are disabled.

Origin changes clear the old device credential before authenticated traffic; the new
address must be paired. Invalid pairing codes do not trigger revocation state. Local
cleanup refuses originals with known queued trash/purge intents. These safety cases
are included in the338-test suite.

Final queue/recovery review also preserves HTTP408/429 intents and reports terminal
album/tag/edit errors through the existing screens without re-enqueuing rejection.
A per-library cache rejection record survives concurrent drains for24 hours. All
request-owned cache reads/writes capture their library explicitly; stalled native
I/O cannot hold the credential commit queue. The real public sync cancellation and
re-pairing regression passes. Full mobile suite:344 tests, type and lint checks pass.

Cache writes also share a per-library SQL lane distinct from the cancellable network
lane. It releases only when the native transaction actually finishes, so a failed
best-effort mirror cannot roll back an acknowledged offline edit. The real SQLite
regression exercises overlapping public upsert/enqueue helpers and verifies the
intent commits independently after the mirror rolls back.

Installed QA follow-up at32a51a2: both standalone artifacts compile and have clean
commit/lock checksums. The iOS candidate retains its connection on restart and keeps
its album picker open with a terminal error after a newly created QA album is removed
through the real server API. Terminal messages now provide plain-language guidance.
Native CI exposed separate-shell Android script execution and an iOS keyboard-hide
selector failure; the smoke sequence is corrected and hidden diagnostics/form
screenshots are retained. Final installed CI remains pending in PR36.

The launch-route follow-up reproduces and fixes cold / opening Collections despite
NativeTabs initial-route metadata. An explicit root entry now opens Photos, verified
on the rebuilt iOS app after a true restart from Collections. Smoke assertions require
the selected Photos tab. Run38209516210 passed all twelve ordinary CI checks; iOS
paired and navigated to Settings before a combined accessibility-label mismatch,
while Android stopped before fixture injection because its AVD lacked shared storage.
The selector, AVD storage/mount precondition, and failure-time artifact provenance
are corrected; the final installed rerun remains pending in PR36.

Run 38277720343 skipped native jobs after Expo's remote recommended patches changed
mid-review. The compatible patch set is now Expo 57.0.28/UI 57.0.23/dev-client 57.0.20/
router 57.0.26/splash 57.0.10. CI validates the installed SDK matrix reproducibly, and a
negative React Native 0.0.1 probe correctly fails against expected 0.86.3. Fresh
advisory checks remain online; all 344 mobile regressions and type/lint checks pass.

CI 38279722296 at 5e90397 passed the full installed iOS 26.5 flow: pairing, selected
Photos navigation, tab browsing, cold restart, confirmed real import receipts and
artifact provenance. Android compilation passed, but the AVD ran with `-accel off`
and aborted fixture creation before launching the app. Runner-only KVM access,
required acceleration, an actual write/readiness probe, bounded initial ADB retries
and retained storage/logcat diagnostics now gate the Android retry. No Android
installed certification is inferred from its successful compilation.

A final same-owner cancellation regression catches resumed stale cache deletes and
cursor rewind after uncancelable native I/O. Cache queue-entry/post-I/O checks and
per-change/reset/cursor fences prevent this; the SQL lane still waits for actual
native completion. Current full mobile suite:346 tests plus type/lint. The next
Android retry also records Gradle stacktraces, filesystem space and build reports:
e286f7f's unchanged app runtime failed at APK packaging before the emulator stage,
while its iOS installed flow passed again.

Installed Android smoke follow-up (2026-10-13): run 38289309652 passes standalone
packaging, mandatory acceleration, pairing and tabs. Its captured log contains
“All caught up” below the 320×640 viewport and a Backup finished notification;
the assertion failed on visibility. The test now scrolls the action and final
status into view while preserving the independent imported-original receipt gate.
Local final artifacts record clean source 7d3d89d and dependency lock checksums.
This failed smoke is not counted as installed certification.

Native input follow-up (2026-10-13): the same final-code iOS run failed before
pairing because the automation entered only “h” rather than the QA URL. The
screenshot and driver log agree; the pinned driver sends a30Hz suffix after its
slow first character. Smoke input now uses the slow one-character path on iOS
and exact read-back assertions on both platforms for URL and pairing code. See
[Maestro's pinned input helper](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Helpers/TextInputHelper.swift).
No flow retry, server assertion or authentication gate is weakened.

Pairing expiry follow-up (2026-10-13): all14 checks pass on f1c3fdd in run
38291971152 (Android one confirmed original, iOS seven, both cold Photos restart).
Run38293304684 passes Android and iOS exact input, but the five-minute production
code expires during the slow iOS flow. QA now creates its authenticated single-use
code immediately before entry; production expiry/authentication are retained.
Invalid, used and expired codes now explain recovery in Settings → Devices;
three response-boundary tests verify preserved credentials/no false revocation.
349 mobile tests cover the final implementation; current-source native rerun follows.

Final static review (2026-10-13): the fresh-code POST must supply `body: ''`
for Maestro's pinned OkHttp client, although the server endpoint consumes no body.
This client-contract mismatch is corrected before final validation. Session/owner
headers, five-minute expiry, single-use redemption, exact native input, imported
original receipts and restart assertions remain required. No further manual UI
checks or repeated full mobile runs are performed; final automated CI owns validation.

Browser reconnect follow-up (2026-10-13): automated CI38347315759 exposes a
lost online event while the foreground offline-upload drain still holds its lease.
The page now preserves that wake and reruns after release. A deterministic coded
regression holds the first POST through reconnect and requires a real202 retry,
with optional Background Sync disabled. No manual UI verification is used.
The unrelated Chromium native segfault recovered on its existing test retry.

The browser foreground and service worker also share retry classification now:
HTTP408/429 retain queued originals rather than deleting them as unsupported files.
Two coded response-boundary cases require successful real202 delivery after retry.
The intentional worker-blocking warning is scoped only to those regression tests.

Completed browser recovery validation: the focused coded upload cases pass,
including real202 delivery after overlap,408 and429. Web type/build and required
Go checks pass; standards/spec reviews are clear. Final branch CI follows.

## Delivery evidence (2026-10-13)

All twelve findings and follow-ups are implemented and reviewed. Final mobile
code eeb858f passes both installed Android/iOS jobs in run 38347315759. Final web
revision 676cbcc passes all twelve other checks in run 38349437771, including 349
mobile tests and 127 browser cases. Mobile/shared trees, native CI and Go backend
source except embedded web UI are identical between those implementation revisions.
The configured automatic native rebuilds are still running and are reported
separately; no manual UI passes or repeated full local suites are added.
See [exact verification/provenance](mobile/NATIVE_VERIFICATION.md) and the release
checklist for remaining physical-device, iCloud/Live Photo, resource and signing
certification. PR36 contains the completed changes; production is not deployed.
