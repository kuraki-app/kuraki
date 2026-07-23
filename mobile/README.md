# Kuraki mobile

A shared Expo/React Native app for iOS and Android. It backs the phone's camera
roll up to a Kuraki server using a **revocable device token**, browses the
library offline, and shows an honest per-item backup state. Its look is ported
from the web app — the same Kura/Vault registers, palette, and fonts.

## First run: connect to your server

The app is gated on setup. On first launch it walks you through:

1. **Welcome** — what Kuraki is.
2. **Server address** — *required.* Enter your server's address; a bare LAN IP
   like `192.168.1.40` is fine (it's normalized to `http://192.168.1.40:3000`).
   The app probes `GET /api/status` so a wrong address fails here, before pairing.
3. **Pair** — scan the QR from the web app's **Devices** page (it fills in the
   address and claims a revocable device token for you), or paste a token by hand.
4. **Photos permission** — explained before the OS prompt.

After setup you always land straight in the app — a revoked token or an
unreachable server never sends you back through onboarding. The only way back to
setup is **Settings → Disconnect this device**.

## Automatic backup

Turn on **Automatic backup** (or tap **Back up new photos**) and the app
enumerates the camera roll, uploads every photo/video the server hasn't yet
accepted, and records progress durably. Already-backed-up local asset IDs are
persisted (`@react-native-async-storage/async-storage`) and uploads use the
server's resumable session API plus content-hash dedup, so a restart or a dropped
connection never creates a duplicate:

- **Survives restart** — completed items are remembered and skipped.
- **Survives network loss** — each chunk retries with backoff and resumes from the
  server's acknowledged offset.
- **Honest failures** — items that can't upload appear under "Needs attention"
  with the reason, and retry on the next run.
- **Runs in the background** — with automatic backup on, the app registers an OS
  background task (`expo-background-task`) so new photos back up periodically even
  when the app is closed. The OS decides the cadence (Android ≈ 15 min minimum;
  iOS adapts to usage and power); the same engine runs each wake, so nothing
  uploads twice.
- **Streams large files** — uploads read the file one chunk at a time through a
  native `expo-file-system` handle, so a multi-gigabyte video never fills memory.

On the Backup tab, the **Albums** row opens a picker: back up everything (default)
or select specific device albums. An item in several selected albums uploads once.

## Library tab

The **Library** tab browses the server's photos on the phone. It reads the
device-authenticated `/api/*` routes (Bearer token) — the same one filter
language the web app uses. A segment control switches between:

- **Timeline** — a search box + All / Photos / Videos / Favorites chips and a
  **Tags** browser, over an infinite grid with a full-screen swipeable viewer
  (images and in-app video playback).
- **Albums** — view, create, and add/remove.
- **On this day** — the memories view.
- **Places** — a native **MapLibre** map (OpenFreeMap vector tiles, no API key)
  that clusters your geotagged photos; tap a cluster to zoom, a pin to open the
  viewer, or a place in the sheet to see its grid.

**Tag** a photo from the viewer (pick existing tags or create one) and browse by
tag. **Trash** and **Duplicate review** (resolve near-identical copies with native
controls) live under Settings.

- **Offline cache.** Metadata is mirrored into a local **expo-sqlite** database, so
  the grid paints instantly on open and stays browsable with no connection; search
  and filters run against the local mirror when the server is unreachable.
  Thumbnails use expo-image's disk cache, capped so it can't grow unbounded.
- **Server-authoritative, offline-safe edits.** Favorites, album add/remove,
  tagging, and trash update the UI immediately, write through to the server, and —
  if offline — queue in a mutation log that flushes on reconnect. A delta feed
  (`/api/changes`) reconciles changes made elsewhere; if the phone falls too far
  behind, the server signals a resync and the mirror rebuilds.

## Connection state

The app distinguishes two very different failures:

- **Can't reach the server** (wrong Wi-Fi, server down, or a home server whose
  DHCP lease moved it) — the cached library stays browsable and a banner offers
  **Retry** and **Edit address**. Your token is still valid; only the address is
  stale.
- **Disconnected** (the server revoked this device's token) — the app clears the
  token and prompts you to re-pair. This banner is dismissible on Library but
  **stays put on Backup**, so "your photos aren't being backed up" is never hidden.

## Develop

```sh
npm install
npx expo start        # then open in Expo Go, or a dev build, on a device
```

Point the app at a running Kuraki server through the on-device setup flow above
(server address + QR or token). The server address and device token are stored in
SecureStore.

Checks (also gated in CI):

```sh
npx tsc --noEmit      # types
npm run lint          # expo lint
npm run test          # vitest — pure logic: url, connection, mutation queue
npm run check-tokens  # regenerate design tokens from web/src/app.css and fail on drift
```

### Design tokens are generated

`src/design/tokens.ts` is **generated** from the web palette by
`scripts/sync-tokens.mjs` (which parses `web/src/app.css`), so the mobile palette
can't drift from the web one — CI runs `check-tokens` to enforce it. Never edit
`tokens.ts` by hand; change `web/src/app.css` and run `npm run sync-tokens`. The
Kura/Vault registers live in `src/design/registers.ts`.

### Release builds

Signed internal and production build profiles live in `eas.json`. Because CI only
runs typecheck/lint/unit tests (no device pass), work through
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) on real hardware before any
TestFlight, Play internal-track, or public build.
