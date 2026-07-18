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

## Spec 2 (mobile parity) device-test flows

Before the Spec 2 release build, exercise the following flows on both iOS and Android:

- [ ] **Albums: create and add photos.** Create an album on the device (online only);
      multi-select photos in the Library → "Add to album"; verify the album and its members
      appear correctly on the web library.
- [ ] **Trash: delete, restore, and permanent delete.** Multi-select photos in the Library
      → "Move to trash"; open Settings → Trash; verify the deleted photos appear in Trash;
      Restore one → verify it reappears in the Library; select a photo in Trash → "Delete forever"
      (confirm dialog) → verify permanent deletion.
- [ ] **Offline mutation queue: trash, restore, and album add.** While offline (kill network or use
      Airplane mode), delete a photo to trash, restore another, and add a photo to an album;
      reconnect to network; verify the server reflects all three mutations.
- [ ] **Album creation offline.** Attempt to create an album while offline; verify the UI shows
      "Connect to create an album" (not silently queued).
- [ ] **On this day (memories).** Navigate to the Library tab → "On this day" segment; verify it
      loads with past-date matches; repeat while offline and verify it shows an empty or error state
      without crashing.
- [ ] **Trash navigation.** Settings → Trash → back button (native/custom affordance); verify the
      back gesture or button navigates correctly to Settings on both iOS (swipe) and Android.
