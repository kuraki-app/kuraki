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
- **Runs in the background** — with automatic backup on, the app registers an
  OS background task (`expo-background-task`) so new photos back up periodically
  even when the app is closed. The OS decides the cadence (Android ≈ 15 min
  minimum; iOS adapts to usage and power); the same engine runs each wake, so
  nothing is uploaded twice.
- **Streams large files** — uploads read the file one chunk at a time through a
  native `expo-file-system` handle, so a multi-gigabyte video never fills memory.

Per-album selection and QR pairing are the next milestones.

## Run in Expo Go

```sh
npm install
npx expo start
```

Use Expo Go on an iOS or Android device first. The app stores the server address
and device token in SecureStore. Create the token from an authenticated Kuraki
web session with `POST /api/devices`, then enter it in Settings.
