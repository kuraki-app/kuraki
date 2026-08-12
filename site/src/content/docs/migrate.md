---
title: Migrate an existing library
description: Bring photos across from Google Takeout or an Immich server without losing metadata.
order: 30
---

## Google Takeout

Export from Google Photos, unpack the archives, and point Kuraki at the folder:

```sh
kuraki import /path/to/takeout
```

Takeout scatters each photo's metadata into a sidecar JSON file next to it, and truncates long
filenames so the two no longer match. Kuraki reads those sidecars and falls back to a title index
when the names have been cut, so capture dates, GPS, captions and favorites survive the trip rather
than every photo arriving dated the day you exported it.

## Immich

```sh
kuraki migrate immich --url https://immich.example.com --api-key <key>
```

Reads directly from a running Immich server over its REST API and preserves albums, favorites,
ratings and capture metadata. It is resumable (`--resume`), can be rehearsed first (`--dry-run`),
and can be limited to recent items (`--since`). Progress is inspectable at any time:

```sh
kuraki migrate status
```

Full options and caveats: [MIGRATING.md](https://github.com/kuraki-app/kuraki/blob/main/MIGRATING.md).

## Photos already on a mounted disk

If the files should stay where they are, add an **external library** in **Settings → Server**.
Kuraki indexes them in place and never copies or moves them — and removing the library later forgets
the index without touching a single file.
