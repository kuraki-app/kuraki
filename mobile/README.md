# Kuraki mobile

The Capture client is a shared Expo/React Native app for iOS and Android. It
backs the phone's camera roll up to a Kuraki server using a revocable device
token and shows an honest per-item backup state.

## Automatic backup

Turn on **Automatic backup** (or tap **Back up new photos**) and the app
enumerates the camera roll, uploads every photo/video the server has not yet
accepted, and records progress durably. Because the set of already-backed-up
local asset IDs is persisted (`@react-native-async-storage/async-storage`) and
uploads use the server's resumable session API plus content-hash
deduplication, a restart or a dropped connection never re-creates a duplicate:

- **Survives restart** — completed items are remembered and skipped.
- **Survives network loss** — each chunk retries with backoff and resumes from
  the server's acknowledged offset.
- **Honest failures** — items that cannot upload appear under "Needs attention"
  with the reason, and are retried on the next run.

Album selection, QR pairing, and OS background scheduling are the next
milestones. Large-video uploads currently buffer per file; streamed file reads
are a planned refinement.

## Run in Expo Go

```sh
npm install
npx expo start
```

Use Expo Go on an iOS or Android device first. The app stores the server address
and device token in SecureStore. Create the token from an authenticated Kuraki
web session with `POST /api/devices`, then enter it in Settings.
