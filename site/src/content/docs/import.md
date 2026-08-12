---
title: Import your photos
description: Bulk-import a folder, watch a directory, or back up from your phone.
order: 20
---

## A folder on the server

```sh
kuraki import /path/to/photos
```

Recursive, resumable, and deduplicated by BLAKE3 content hash — importing the same folder twice
imports nothing the second time. Originals are copied into `originals/YYYY/MM/` and never modified
again.

## Keep watching a folder

```sh
kuraki import /path/to/incoming --watch
```

Rescans on an interval and imports anything new. Because the resume state makes each rescan cheap,
this pairs well with Syncthing, rsync or anything else that drops files into a directory.

## From your phone

Pair the mobile app from **Settings → Devices** by scanning a QR code, and it backs up the camera
roll in the background — Wi-Fi only by default, resuming mid-file after an interruption. The device
gets its own revocable token; revoking it from the same screen cuts that device off immediately.

## Drag and drop

The web UI accepts dropped files anywhere in the window, and uploads run through the same background
import queue as everything else. **Settings → Activity** shows progress and per-file errors.
