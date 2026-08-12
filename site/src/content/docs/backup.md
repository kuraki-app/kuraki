---
title: Backup and restore
description: A portable archive of the whole library, and the recovery paths for when something goes wrong.
order: 50
---

## The library on disk

Everything lives under one directory, and the database stores pointers rather than image bytes:

```
kuraki-data/
├─ kuraki.db          metadata and pointers only
├─ originals/YYYY/MM/ your files, written once, never modified
├─ derivatives/<id>/  thumbnails, posters, transcodes — all regenerable
├─ trash/             inside the retention window
└─ snapshots/         automatic pre-migration database copies
```

Copying `originals/` is a complete copy of your photographs. Nothing else is needed to read them —
they are ordinary files in dated folders, openable by anything.

## Portable archives

```sh
kuraki backup /mnt/backups/kuraki-2026-08-12.tar.gz
```

Takes an online, SQLite-consistent snapshot first, so it is safe to run against a live server.
Setting `KURAKI_BACKUP_DIR` runs this on an interval unattended — put it on a **different disk** than
the library, or it protects you from nothing.

Restoring stages and validates the archive's manifest in a temporary sibling directory before
swapping it into place, and refuses to write into a library that is not empty:

```sh
kuraki restore /mnt/backups/kuraki-2026-08-12.tar.gz
```

Restore is a command-line operation on purpose. It replaces an entire library, which is not something
that should sit behind a browser session.

## Checking the library is intact

```sh
kuraki verify
```

Re-checksums every original and reports anything corrupted or missing. It also runs on a schedule and
reports into **Settings → Server**.

## Locked out of the web UI

```sh
kuraki passwd --username you
```

Resets a password offline, directly against the database. This is the recovery path when nobody can
sign in.
