---
title: How Kuraki works
description: The flows — what happens when you import a photo, search for one, delete one, or back up a phone, and what each step needs from you.
order: 15
---

Kuraki is small enough to hold in your head. Five ideas explain nearly all of its behaviour.

1. **A library belongs to exactly one account.** Two accounts on one server are two libraries that
   cannot see each other — not even for an admin, who administers the *server*, not other people's
   photographs.
2. **Originals are written once and never touched again.** Nothing Kuraki does later — a corrected
   date, a caption, a deleted album — rewrites the file you imported.
3. **Everything else is derived and disposable.** Thumbnails, posters, the search index, the map,
   the duplicate groups: all rebuilt from the originals if lost.
4. **Metadata lives in the database, not in your files**, so editing metadata can never corrupt a
   photograph.
5. **The server is the source of truth.** Every client shows a view of it and reconciles back to it.

## What happens to a photo when it arrives

Every route in — a folder import, a drag-and-drop, a phone backup, a migration — ends in the same
pipeline:

1. **Admission.** The file's *content*, not its extension, decides what it is. Unrecognized content
   is reported, not stored as a mystery.
2. **Hashing.** A content hash identifies it. If that hash is already in the library, the import
   records a duplicate and stops — one copy is kept, whatever the filename.
3. **Storage.** The original is copied into a dated folder. Writing refuses to overwrite anything.
4. **Metadata.** Capture date, camera, dimensions, orientation and GPS are read from the file.
5. **Place.** Coordinates are resolved to a city and country **on your server**, from bundled data.
   No request leaves the machine.
6. **Derivatives.** A thumbnail; for video, a poster frame and a playback version if the codec is
   not browser-safe.
7. **Indexing.** Filename, caption, camera, place and tags become searchable — and text found
   inside images, if recognition is switched on.
8. **Grouping.** A RAW and its JPEG, or a live photo's still and clip, are stacked behind one
   representative.

If a step fails, the asset still exists and the original is still downloadable. Failures are listed
with a reason and can be rebuilt once the cause is fixed.

## Finding things

There is **one filter language**, shared by the web filter bar and the phone: free text, date range,
media type, camera, favorite, rating, place, tag, album, and the archived/hidden shelves. Filters
combine, and any set of them can be saved under a name and re-applied later — a saved search stores
the filter, not the results.

Text matches **inside** words, not only at their start: `0001` finds `IMG_0001.jpg`.

## Deleting

Deletion has two steps, and only the second is irreversible. Moving to trash takes an item out of
the timeline and holds it for the retention window (30 days by default), restorable with its albums,
tags and favorite state intact. After that — or when you ask explicitly — it is purged from disk.

Nothing is ever deleted automatically. Not duplicates, not import sources, not originals.

## Many devices, one library

Every change is recorded in an ordered feed. A browser updates live as the feed advances; a phone
mirrors the library locally, so it browses and searches offline, queues edits made without a
connection, and replays both directions on reconnect. If a device has been away longer than the
feed covers, the server says so and the device rebuilds rather than silently skipping changes.

Two failures that look alike are kept apart, because the remedies are opposite: **cannot reach the
server** (the credential is fine, the address or network is not) and **disconnected** (the server
revoked this device, so pair it again).

## The full guide

Every flow, with the data each one needs and what it returns:
[USER_GUIDE.md](https://github.com/kuraki-app/kuraki/blob/main/USER_GUIDE.md).
