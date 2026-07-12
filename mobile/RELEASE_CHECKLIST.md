# Mobile release checklist

Kuraki intentionally sends no mobile crash reports to a third party. Support
diagnostics remain local unless a user explicitly exports them in a future
feature.

Before a TestFlight, Play internal-track, or public build:

- [ ] Confirm ownership of `app.kuraki.mobile` in Apple Developer and Google
      Play before creating store records; change identifiers before any external
      release if the organization requires a different namespace.
- [ ] Run a signed EAS `development` build on physical iOS and Android hardware.
- [ ] Exercise fresh install, full/limited/denied photo permissions, QR pairing,
      manually entered credentials, revoked device credentials, and reconnect.
- [ ] Upload a photo and a multi-gigabyte video; interrupt chunks, restart the
      app/device, and confirm server offset recovery and content-hash dedup.
- [ ] Test iCloud/offloaded media, selected albums, no network, metered network,
      low battery, charging, OS task expiration, force-quit, and cold restart.
- [ ] Record device/OS/version, observed scheduling behavior, battery/network
      impact, and unresolved failures in the release issue.

Background scheduling is opportunistic. iOS and Android decide when deferred
work may run; the client must accurately communicate that it cannot promise an
immediate background upload.
