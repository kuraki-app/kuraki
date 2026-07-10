# Kuraki mobile

The Capture client is a shared Expo/React Native app for iOS and Android. Its
first job is simple: show an honest per-device backup state using a revocable
device token. Resumable upload-session support is provided by the Kuraki server;
album selection, camera-roll enumeration, and background scheduling are the
next mobile milestones.

## Run in Expo Go

```sh
npm install
npx expo start
```

Use Expo Go on an iOS or Android device first. The app stores the server address
and device token in SecureStore. Create the token from an authenticated Kuraki
web session with `POST /api/devices`, then enter it in Settings.
