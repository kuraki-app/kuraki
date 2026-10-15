# Mobile verification evidence — 2026-10-13

All identified implementation fixes are committed on `codex/mobile-hardening` in
[PR36](https://github.com/kuraki-app/kuraki/pull/36). The final delivery uses coded
validation; manual simulator/browser checks are not repeated.

## Passing installed application checks

[Native run 38347315759](https://github.com/kuraki-app/kuraki/actions/runs/38347315759)
passes both Android and iOS installed jobs for mobile revision
`eeb858f4595ea50bbdc2d5bdf5c603558a4dc99b`. Its browser job exposed a separate
reconnect race, fixed in the later web revision below; this run is not described
as wholly green.

| Platform | Runtime | Passing foreground evidence |
|---|---|---|
| Android | API 35, x86_64 disposable emulator, mandatory KVM | Standalone QA APK, exact URL/code read-back, pairing, four tabs, imported-original receipt, cold restart selects Photos |
| iOS | iPhone 17 Pro, iOS 26.5 arm64 simulator | Standalone QA app, slow exact input, fresh single-use pairing, four tabs, imported-original receipt, cold restart selects Photos |

Neither application needs Metro. Each starts with cleared app state and a
disposable server. A separate server query requires an active owner-matching
import receipt whose content hash and size match its original. No local photo
deletion is executed. No operator originals or credentials are used.

## Final web and server checks

[Delivery run 38349437771](https://github.com/kuraki-app/kuraki/actions/runs/38349437771)
passes all twelve non-native checks for implementation revision
`676cbcc4a52499c83395d61680f0b46700a56623`: 349 mobile regressions, SDK compatibility
and dependency security, Go race/vet/format, generated contract, web type/build,
127 Chromium cases, tagged media, pure-Go cross-compiles and Docker/vulnerability
gates. Its automatic native rebuilds were still running when this evidence was
recorded; the passing native results above are recorded separately.

`mobile/`, `shared/`, native CI and Go backend source excluding embedded web
assets are unchanged between these two implementation revisions. The mobile
Git tree is `c7502c610d6d69a14b790ac88f0534b4396e78e3`; the shared tree is
`918980073fd746031bc14a096096b032f80da5ae` at both revisions. The later change is
browser upload recovery plus its generated UI: pending reconnect wakes survive
an active drain, and HTTP 408/429 retain originals in foreground and worker queues.
Three deterministic coded regressions require later real 202 delivery. Standards
and spec reviews report no remaining actionable finding.

## Exact artifact provenance

CI tests the PR combined with main. Both passing native records identify the
clean tested merge `334c100f2a54936d53bd48c9cd8f63b198b12396`. The records retain platform/profile, build time,
SDK versions, dependency lock hash and artifact SHA256:

- [Android provenance](native-proof/android-ci.json), independently matched against
  the downloaded APK.
- [iOS provenance](native-proof/ios-ci.json), hashing the built app's paths, modes,
  symlinks and contents as `directory-path-mode-content-v1`.

The dependency lock SHA256 is
`6d1dd1d64fc2cc0e5874903a52666033ef571406990877167221e2f8a6727765`.
These builds use Expo 57.0.28, React Native 0.86.3 and Worklets 0.10.1. CI retains QA
artifacts/logs for seven days; committed provenance remains available. Later
commits containing only these documentation records do not change runtime code.

## Release certification still required

[The mobile audit](../MOBILE_READINESS_REVIEW.md) records all twelve fixed findings.
[Dependency security](DEPENDENCY_SECURITY.md) explains the two narrow source-checked
mitigations without upstream releases; all other advisories fail the gate.

Physical-device locked scheduling, iCloud/Live Photo vendor behavior, large-library
and multi-gigabyte video RSS/battery measurements, and production Apple/Google
signing remain [release requirements](RELEASE_CHECKLIST.md). Foreground
simulator/emulator evidence does not certify those behaviors.
