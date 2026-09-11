# Kuraki user guide

**What happens, in what order, and what you have to supply at each step.**

This guide describes Kuraki from the outside: the flows a person moves through, the
information each flow needs, what the server does with it, and what comes back. It
contains no code, no API details, and nothing about how any screen looks — those
change. Behaviour is the contract.

- Installing and running the server: **[README.md](./README.md)** and **[DEPLOYMENT.md](./DEPLOYMENT.md)**
- Bringing an existing library across: **[MIGRATING.md](./MIGRATING.md)**
- Which file formats do what: **[MEDIA_SUPPORT.md](./MEDIA_SUPPORT.md)**

---

## 1. The model

Five ideas explain nearly everything Kuraki does.

1. **A library belongs to exactly one account.** There is no shared pool. Two
   accounts on one server are two libraries that cannot see each other.
2. **Originals are written once and never touched again.** Import copies your file
   into a dated folder and stops. Nothing Kuraki does later — editing a date,
   rotating a thumbnail, deleting an album — rewrites that file.
3. **Everything else is derived and disposable.** Thumbnails, video posters,
   playback versions, the search index, the map, the duplicate groups: all of it
   is rebuilt from the originals if lost.
4. **Metadata lives in the database, not in your files.** A caption or a corrected
   date is recorded alongside the pointer to the file, so editing metadata can
   never corrupt a photograph.
5. **The server is the source of truth.** Every client — browser, phone — shows a
   view of the server's state and reconciles back to it after any disagreement.

A consequence worth internalizing: **copying the `originals/` folder is a complete
copy of your photographs.** Everything else is convenience.

---

## 2. Who can do what

| | Regular account | Admin account | Paired device (phone) |
|---|---|---|---|
| Browse, search, view, download its own library | ✅ | ✅ | ✅ |
| Organize (albums, tags, ratings, favorites, captions, dates) | ✅ | ✅ | ✅ |
| Trash, restore, permanently delete its own photos | ✅ | ✅ | ✅ |
| Upload / back up | ✅ | ✅ | ✅ |
| Pair and revoke its own devices | ✅ | ✅ | ❌ |
| Change its own password | ✅ | ✅ | ❌ |
| Create, disable, delete accounts | ❌ | ✅ | ❌ |
| Change server settings | ❌ | ✅ | ❌ |
| Link a folder on the server's disk as an external library | ❌ | ✅ | ❌ |
| Scan its own library for duplicates, export the whole thing | ✅ | ✅ | ❌ |
| Read integrity and backup reports (these describe the whole server) | ✅ | ✅ | ❌ |
| **See another account's photos** | ❌ | ❌ | ❌ |

The last row is the important one. An admin administers **the server**, not other
people's photographs. There is deliberately no path from one account into another's
library — not for an admin, not for anyone.

A device credential is narrower than an account: it can read and change the library
it was paired to, and it can never manage accounts, settings, or other devices.

---

## 3. Flow: first run

The first person to open a fresh server claims it.

**You supply**

| Field | Required | Rules |
|---|---|---|
| Username | No | Defaults to `admin` |
| Password | Yes | At least 8 characters |

**What happens**

1. The server reports that setup has not been completed, and offers the form
   instead of a sign-in prompt.
2. Your password is hashed (argon2id) and stored. The plaintext is never written
   anywhere.
3. The account is created as an **admin**, and becomes the owner of the library.
4. You are signed in immediately.

**Edge cases**

- If photos were already imported from the command line before anyone visited the
  server, that import created a placeholder owner. Setup **claims** that placeholder,
  so the photos are already in your library when you first sign in — they are not
  orphaned and there is no import to repeat.
- Setup can only run once. Once an account exists, the form is gone for good, and
  further accounts are created by an admin (§18).

---

## 4. Flow: signing in

**You supply:** username and password.

**What happens:** on success you get a session that lasts **30 days** and is bound
to that one browser. Signing out ends that session only.

**Protections**

- Failed sign-ins are throttled per source address — roughly ten quick attempts,
  then one every six seconds.
- Changing your own password ends **every other browser session** you hold, so a
  stolen session cannot outlive the password it came from. **Paired devices keep
  working** — a phone holds its own credential, and you revoke those individually
  (§17). An *admin*-driven password reset is stricter: it revokes that account's
  devices too, because it is used when an account is suspect rather than when its
  owner simply wants a new password.
- A disabled account cannot sign in, and its existing sessions stop working
  immediately.
- Locked out entirely? A password can be reset offline on the server itself, with no
  browser involved; it signs out every session for that account. That is the intended
  recovery path, and it requires access to the machine — which is the point.

---

## 5. Getting photos in

Six routes exist. They all end in the same place: one import pipeline (§6).

| Route | Who starts it | Where the file ends up | Best for |
|---|---|---|---|
| Bulk import of a server folder | Someone with server access | Copied into the library | The initial migration of a big archive |
| Watched folder | Same, once | Copied into the library | A drop-box that other tools sync into |
| Browser upload | Any signed-in account | Copied into the library | A handful of files, right now |
| Phone backup | A paired device | Copied into the library | The everyday habit |
| External library | An admin | **Left where it is**, indexed in place | A NAS share you do not want duplicated |
| Migration from Immich / Google Takeout | Someone with server access | Copied into the library, metadata preserved | Leaving another service |

### 5.1 Bulk import of a folder

**You supply:** a path on the server, and optionally a dry run first.

**What happens:** the folder is walked recursively; every recognized photo or video
is hashed, deduplicated, copied into the library's dated folders, and queued for
derivatives. Progress is reported as it goes.

**What makes this safe to repeat:** import state is remembered per source path, and
files are deduplicated by content. Re-running the same import imports nothing the
second time. Interrupting it and starting again resumes rather than restarts.

**What it never does:** touch, move, or delete anything in the source folder. Cleaning
up the source is your decision, after you have verified the library (§20).

### 5.2 Watched folder

Same as above, except the folder is rescanned on an interval and anything new is
imported. Because rescans are cheap, this pairs naturally with a sync tool dropping
files in.

### 5.3 Browser upload

**You supply:** files, dropped into the window or chosen from Upload in Settings on a phone.

**What happens:** each selected file first enters an account-specific queue in browser storage, then
uploads independently. If the connection drops, it resumes when connectivity returns or Kuraki is
reopened; browsers that support Background Sync can retry after the page closes. Once the bytes land,
the server stages the file and queues an import job. Progress and errors are visible in Activity.

**Browser boundary:** a website cannot silently enumerate the phone's camera roll. You choose the
files; automatic camera-roll backup is the native app's job. PWA installation and closed-page retry
also require browser support and a secure origin. The foreground queue still resumes without them.

**Why staging matters:** two uploads called `IMG_0001.jpg` do not collide. Each gets
its own staging space, and both are imported.

### 5.4 Phone backup

**Pairing — you supply:**

| Field | Required | Notes |
|---|---|---|
| Server address | Yes | A bare address is enough, and it decides how the app connects: something that can only be local (an IP, a single name, `.local`/`.lan`/`.internal`) is tried over plain HTTP on the server's own port, and a domain name is tried over HTTPS first. Whichever answers is the one kept, and a wrong address fails here rather than later. Typing a full `http://…`/`https://…` address overrides the guess |
| Pairing code | Yes | Generated on the server, scanned as a QR or entered by hand |
| Device name | Yes | How the device appears in your device list |
| Photo library permission | Yes | Requested by the phone's own operating system |

**What happens**

1. The server mints a pairing code that is **single-use** and valid for **five
   minutes**. Only a hash of it is stored, so the code cannot be recovered from the
   server afterwards.
2. The phone redeems it and receives its own credential. That credential is shown
   once, stored in the phone's secure storage, and never displayed again.
3. The phone can now read and change the library it was paired to, and nothing else.

**Changing servers.** Pointing the app at a different server — or pairing it to a different
account on the same one — discards everything it had cached from the previous library, including
any changes still queued offline. This is not optional: a cache from one library says nothing true
about another, and the app previously kept showing the old one while reporting that it was
connected to the new one.

**Which address to type.** The pairing screen offers one. On a bare-metal install
the server reads it from its own network interfaces, which is right. In a
container it cannot: the only interface a container has is a bridge address on
the *container's* port, which no phone can route to — so the server offers
nothing and the screen keeps whatever address your browser is already using. If
that address is `localhost`, the screen says so plainly, because a phone using
it would try to reach itself. An operator can end the guessing by stating the
address once (`KURAKI_PUBLIC_URL`), which is the only workable answer behind a
reverse proxy, where the published scheme, host and port all differ from the
server's own.

**Backing up — what happens**

1. The app enumerates the camera roll (everything by default, or only the device
   albums you pick).
2. Each item is uploaded in chunks. The server acknowledges how much it has, so an
   interrupted upload resumes from that point rather than starting over — mid-file,
   not merely mid-file-list.
3. Content hashing means an item that is already in the library is recognized and
   skipped, so a reinstall or a restore-from-backup does not create duplicates.
4. Completed items are remembered locally, so a restart does not re-walk work
   already done.
5. Backup runs in the background on the operating system's schedule, and on Wi-Fi
   only unless you say otherwise. The OS decides the cadence; every wake runs the
   same engine, so nothing is uploaded twice.
6. Anything that cannot be uploaded is listed with its reason and retried later. It
   is never silently dropped.

**Capture dates:** the phone sends the camera roll's creation time as a fallback.
Embedded EXIF still wins where it exists, because it travels with the file — but a
screenshot with no EXIF now arrives with a real date instead of no date at all.

### 5.5 External library (photos that stay where they are)

**You supply (admin only):** a name, and an absolute path on the server's disk.

**What happens:** the files are indexed in place — read, hashed, and given
thumbnails — and **never copied or moved**. Removing the external library later
forgets the index and touches not a single file.

**Why this is admin-only:** naming a path is naming part of the server's filesystem.
Paths inside Kuraki's own data directory are refused, so this cannot be used to index
another account's originals.

### 5.6 Migrating from another service

Both migrations preserve far more than files:

- **Google Takeout** — export, unpack, and import the folder. Kuraki reads the
  sidecar files Google writes next to each photo (and matches them by title when
  Google has truncated the filenames), so capture dates, locations, captions, and
  favorites survive instead of every photo arriving dated the day you exported.
- **Immich** — reads from a running server over its API, bringing albums, tags,
  favorites, ratings, archive state, captions, locations, and stacks. It is
  resumable, rehearsable as a dry run, limitable to recent items, and safe to
  re-run. Progress is inspectable at any point.

Details and caveats for both: **[MIGRATING.md](./MIGRATING.md)**.

---

## 6. What happens to a file after it arrives

Every route above converges here. Understanding these steps explains most of what
you see afterwards.

1. **Admission.** The file's actual content — not its extension — decides what it
   is. A `.jpg` that is really a video is imported as a video. Content that is not
   recognized media is rejected and reported, not stored as a mystery.
2. **Hashing.** A content hash identifies the file. If the library already has that
   hash, the import records a duplicate and stops — one copy is kept, whatever the
   filename or folder.
3. **Storage.** The original is copied to a dated folder derived from its capture
   date. Writing refuses to overwrite anything that already exists.
4. **Metadata extraction.** Capture date, camera, dimensions, orientation, and GPS
   are read from the file.
5. **Place lookup.** If there are coordinates, a city and country are resolved
   **on your server, from bundled data**. No request leaves the machine.
6. **Derivatives.** A thumbnail is generated; a video gets a poster frame, and a
   playback version if its codec is not browser-safe.
7. **Indexing.** Filename, caption, camera, place, and tags become searchable. If
   text recognition is switched on, text found inside images is indexed too.
8. **Grouping.** Files that clearly belong together — a RAW and its JPEG, a live
   photo's still and its motion clip — are stacked behind one representative.
9. **Change recorded.** The addition enters a change feed, which is how your other
   devices learn about it (§16).

**When a step fails**, the asset still exists and the original is still downloadable.
Failures are listed as media health issues with a reason, and a rebuild can be
requested per asset once the cause is fixed (for example, after moving to the Docker
image, which carries broader format support).

**Import acceptance is not a promise of preview.** Kuraki keeps formats it cannot
display. Those appear with a download rather than a picture — never as a broken
image, and never discarded. See [MEDIA_SUPPORT.md](./MEDIA_SUPPORT.md).

---

## 7. Flow: browsing the timeline

The timeline is the library in reverse chronological order, grouped by capture date
— falling back to import date for anything undated.

- **Grouping** can be by day, month, year, or off.
- **Paging** is continuous: scrolling fetches the next page by position rather than
  page number, so new arrivals never shift or duplicate what you are already looking
  at.
- **Jump to a date** to move directly to any point in the library's history.
- **Archived** and **hidden** items are excluded here by default and have their own
  places to live.
- **Each date heading carries a count**, so you can see how much a day holds without
  scrolling through it.
- **On the phone, memories sit above the timeline** as a row of cards — one per year
  that has photos from today's date. Tapping one opens the full memories view. The
  row is absent on days with nothing to resurface.

A tile marks what it is without being opened: a heart for a favourite, a play
triangle and the running time for a video, and a stacked mark where one tile stands
for several near-identical shots.

Only the parts of the timeline near your view are held open at once, so a large
library behaves the same as a small one.

---

## 8. Flow: finding a photo

There is **one filter language**, and every surface uses it — the timeline's filter
bar, the phone, saved searches. Learn it once.

| Filter | You supply | Notes |
|---|---|---|
| Text | Words | Matches filename, caption, camera, place, tags, and recognized text. Matches **inside** words, not only at their start — `0001` finds `IMG_0001.jpg`. Queries shorter than three characters match from the start of a word instead |
| Date from / to | Dates | Inclusive range over capture date |
| Type | Photo or video | |
| Camera | A camera model | Exact |
| Favorite | On / off | |
| Rating | 0–5 | 0 means unrated |
| Place | A city, a country, or both | Values come from the offline place lookup |
| Tag | One tag | |
| Album | One album | |
| Archived | On / off | Off by default |
| Hidden | On / off | Off by default |

Filters combine — every condition must hold. Results are ordered like the timeline
and paged the same way.

**Saved searches.** Name a filter set and it can be re-applied later in one action.
A saved search stores the filter, not the results, so it reflects the library as it
is today.

On the phone, search also shows how many items matched, and the tags in your library
as a row of shortcuts above the results — tapping one browses that tag directly. The
full tag list is always one tap away, whether or not the shortcuts have loaded.

---

## 9. Flow: opening one photo

**What you get:** the largest thing your browser can actually display — the original
where that is safe, otherwise a generated preview or playback version. Alongside it:
capture date, camera and exposure details, place, size, tags, and rating.

**What you can do from here:** favorite, rate, tag, edit the date/location/caption,
add to an album, download the original, archive, hide, or move to trash. Video plays
inline with seeking.

**The download is always the original.** Not the preview, not a re-encode — the
bytes that were imported.

**Details are shown as facts, not fields.** On the phone the details sheet lists one
card per fact — the file and its size and dimensions, the capture date, the camera,
the place — each stating the answer first and what kind of answer it is second. A
card is omitted entirely when the photo carries nothing for it: a screenshot has no
camera, and a photo with no coordinates has no place. Exposure settings (aperture,
shutter, ISO, focal length) are recorded on the server but are not yet sent to the
phone, so they appear in the web app only.

---

## 10. Flow: organizing

All of these are metadata. None of them modify a single original.

| Action | You supply | Reversible | Notes |
|---|---|---|---|
| Favorite | — | Yes | Has its own feed |
| Rating | 0–5 | Yes | 0 clears it |
| Tag | Tag names | Yes | Tags can nest; creating a tag needs a connection, applying one does not |
| Album | Album name; then photos | Yes | Manual membership; a photo can be in several albums; removing from an album never deletes it |
| Archive | — | Yes | Kept out of the timeline, still searchable when asked for |
| Hide | — | Yes | Same idea, stronger intent |
| Caption | Text | Yes | Searchable |
| Capture date | A date and time | Yes | Re-files the photo in the timeline; the original file is untouched |
| Location | Coordinates, or "clear" | Yes | Setting coordinates re-resolves city and country offline |
| Timezone shift | A number of minutes, and a selection | Yes | Corrects a camera clock across many photos at once; apply the inverse to undo |

**Multi-select** applies favorite, archive, hide, trash, restore, permanent delete,
album membership, and export to a whole selection at once. The result reports how
many succeeded and names anything that did not, rather than failing silently as a
group.

---

## 11. Flow: places

Every photo with coordinates has had a city and country resolved locally at import.
The places view maps them, clustered so a dense city is one marker rather than five
thousand. Tapping a place filters the library to it; tapping a point opens the photo.

**No location data leaves your server**, at import or at browse time. The geographic
dataset ships inside the binary.

---

## 12. Flow: memories

"On this day" gathers photos taken on today's date in previous years. It is derived
entirely from capture dates — there is nothing to configure, and nothing is inferred
about the content of the pictures.

On the phone these are grouped by year and surfaced as a row of cards at the top of
the timeline, labelled by distance ("Last year", "5 years ago") and by the year
itself. Each card opens the full view. Photos with no capture date never appear here:
an undated photo is not a memory of any particular day.

---

## 13. Flow: duplicates and stacks

These solve two different problems and behave differently.

**Stacks** are automatic and structural. A RAW and its JPEG, or a live photo's still
and clip, share a name and a moment — so they are shown as one item with the rest one
step away. Nothing is hidden or removed; the timeline just stops showing you the same
capture four times.

**Duplicate review** is a scan you ask for, over the whole library, and it finds
*visually* similar copies — a resize, a re-save, a re-export at another quality —
which content hashing cannot catch, because those files differ byte for byte.
Byte-identical files never reach this stage: they were deduplicated at import.

1. You start a scan of your own library from a signed-in browser. It runs in the
   background, reports progress, and resumes itself if the server restarts mid-run.
2. Results are grouped and stored, so opening the review is instant and repeatable
   rather than recomputed each time.
3. **You decide what happens to each group.** Kuraki never deletes anything
   automatically, and anything you do delete goes to trash first (§14).

---

## 14. Flow: deleting and restoring

Deletion has two distinct steps, and only the second is irreversible.

1. **Move to trash.** The item leaves the timeline and every album view, and its file
   is moved into the trash area. It stays restorable for the retention window —
   **30 days** by default.
2. **Permanent delete.** Either you ask for it explicitly, or the retention window
   expires and a daily cleanup removes it. At that point the file is gone from disk
   and the record is gone from the database.

**Restoring** from trash puts the item back exactly where it was, including its
albums, tags, and favorite state.

**Deleting an account** is separate and deliberately awkward: an account with photos
cannot be removed without explicitly opting into destroying its library, so tidying
up a user list can never quietly erase a library. Disabling the account instead
revokes every session and device credential while leaving every photo intact, and can
be undone.

---

## 15. Flow: getting photos out

Leaving should be as easy as arriving. Four ways out, in ascending order of size:

| Want | How | Result |
|---|---|---|
| One photo | Download from the viewer | The original file, unmodified |
| A selection | Select, then export | One archive of the originals |
| Everything | Whole-library export | Every original in your own library |
| Everything, including metadata | Portable backup archive | Originals plus the database, restorable onto a clean machine |

And the zeroth way, which needs no software at all: **the `originals/` folder is
ordinary dated directories of ordinary files.** Copy it anywhere. Any program can
read it. That is the anti-lock-in guarantee, and it is structural rather than a
promise.

Large exports are prepared and streamed rather than assembled in memory, and are
checked before they start, so an archive never quietly omits a file it could not read.

---

## 16. Flow: staying in sync across devices

Every change to a photo — favorite, edit, tag, album, trash, restore, import,
permanent delete — is recorded in an ordered change feed scoped to your library.

**In the browser:** the server pushes a signal as soon as the feed advances and the
page catches up immediately, with a periodic check as a safety net. A change made on
your phone shows up in an open browser tab without a refresh.

**On the phone:** the library is mirrored into a local database.

- **Reading offline** works: the grid, search, and filters run against the mirror,
  so the app opens instantly and stays usable with no connection.
- **Writing offline** works too: the change is applied locally, queued, and sent when
  the connection returns.
- **On reconnect** the app drains its queue, then replays everything that changed
  elsewhere and updates only the affected items.
- **If a device has been away too long** for the feed to still cover the gap, the
  server says so and the device rebuilds its mirror from scratch rather than silently
  skipping changes.

**Two failures look similar and are not.** The app distinguishes them, because the
remedies are opposite:

| What you see | What it means | What to do |
|---|---|---|
| "Can't reach the server" | Wrong network, server down, or its address moved | Your credential is still valid. Retry, or correct the address. The cached library stays browsable |
| "Disconnected" | The server revoked this device | Pair again. This warning is dismissible while browsing but stays put on the backup screen, so "your photos are not being backed up" is never hidden |

---

## 17. Flow: managing devices

You see your own paired devices, when each was last seen, and can revoke any of them.
Revocation takes effect immediately: that device stops being able to read or change
anything and is prompted to pair again.

**A device credential is shown exactly once, at pairing.** It cannot be retrieved
afterwards — not from the device list, not from the server. A lost phone is handled by
revoking and re-pairing, which is the correct answer anyway.

---

## 18. Flow: managing accounts (admin)

| Action | You supply | Effect |
|---|---|---|
| Create an account | Username, password, role | A new, empty, separate library |
| Change a role | Admin or regular | Grants or removes server administration — never access to photos |
| Reset a password | New password | Ends that account's sessions **and revokes its paired devices** |
| Disable an account | — | Sign-in blocked, sessions and devices revoked, library untouched, reversible |
| Delete an account | Explicit opt-in to destroy the library, if it has photos | Irreversible |

**The server cannot be left without an admin.** The last admin who can still sign in
cannot be demoted, disabled, or deleted — the request is refused rather than leaving
a server nobody can administer.

---

## 19. Flow: settings

Settings resolve in a fixed order: **built-in defaults, then anything stored on the
server, then anything set in the environment it was started with.** The environment
wins.

Two consequences you will see:

- A setting pinned by the environment is shown as pinned rather than being silently
  ignored when you try to change it.
- Changes are labeled as taking effect **immediately** or **after a restart**, so
  you are never left guessing whether something applied.

A small number of settings are environment-only on purpose. The clearest example is
the path of the Android app package, because the endpoint serving it is public — so
which file that is should not be editable from a browser session.

---

## 20. Flow: keeping the library healthy

| Concern | Mechanism | Cadence |
|---|---|---|
| Files silently rotting or vanishing | Integrity check re-reads and re-checksums every original and reports mismatches or missing files | Automatically, about weekly; on demand from a signed-in browser |
| Losing the whole library | Portable archive containing originals and a consistent copy of the database | On demand, or unattended on an interval, keeping a set number of archives |
| Upgrades going wrong | The database is snapshotted automatically before any schema change | Every upgrade that changes the schema |
| Imports failing quietly | Activity view: per-job progress, per-file errors, retries | Continuous |
| Photos that import but cannot be shown | Media health list with reasons, and a per-asset rebuild | Continuous |
| Server liveness | A health endpoint, plus metrics for a monitoring system | Continuous |

**Restore is a command-line operation on purpose.** It replaces an entire library,
which is not something that should sit behind a browser session. It refuses to write
into a library that is not empty, and validates the archive before swapping it into
place.

**One rule about backups:** put them on different hardware than the library. A backup
on the same disk protects you from a mistake, not from a disk.

---

## 21. What Kuraki stores about each photo

Useful when deciding what to expect from search, sorting, and export.

| From the file | From you | From the server |
|---|---|---|
| Content hash | Caption | Import time |
| Capture date, camera and lens, exposure settings | Corrected capture date | Storage path |
| Dimensions and orientation | Location, or its removal | City and country (resolved offline from coordinates) |
| GPS coordinates | Rating | Thumbnail, poster, playback version |
| Media type and format | Tags | Whether a browser can display it |
| Duration, for video | Album membership | Perceptual fingerprint, for duplicate detection |
| Text found inside the image, if recognition is on | Favorite, archived, hidden | Stack membership |

---

## 22. When something looks wrong

| Symptom | Most likely cause | What to do |
|---|---|---|
| A photo shows as a download, not a picture | The format cannot be displayed by browsers, or a derivative failed | Check media health; the original is intact and downloadable. The Docker image supports more formats than a plain binary build |
| Photos imported with no date, grouped as undated | No capture date in the file and none supplied | Edit the date on one, or apply a timezone shift to a selection |
| Everything dated the day you migrated | Sidecar metadata was not read | Re-import through the documented Takeout path — see [MIGRATING.md](./MIGRATING.md) |
| Importing the same folder twice added nothing | Working as designed — content deduplication | Nothing to do |
| The phone says it cannot reach the server | Network, or the server's address changed | Correct the address; the credential is still valid |
| The phone says it is disconnected | Its credential was revoked | Pair it again |
| A trashed photo disappeared | The retention window expired and it was purged | Restore from a backup archive |
| Sign-in stopped working after a password change | By design — every other session ended | Sign in again |
| A change made on one device has not appeared on another | The other device has not reconciled yet | Open or foreground it. A device that fell further behind than the change feed reaches rebuilds its mirror by itself |
| An admin account cannot be demoted, disabled, or deleted | It is the last admin who can still sign in | Promote another account first |

---

## 23. What Kuraki deliberately does not do

Knowing the boundaries is part of knowing the product.

- **No sharing.** No public links, no shared albums, no household accounts. Multiple
  accounts mean multiple isolated libraries.
- **No end-to-end encryption.** The server reads your files — that is how it makes
  thumbnails and search work. It is your server; that is the trade.
- **No face recognition, and no bundled machine learning.** Text recognition inside
  images is available, opt-in, and runs locally.
- **No automatic deletion of anything.** Not duplicates, not import sources, not
  originals. The only automatic removal is trash whose retention window you
  configured has expired.
- **No cloud dependency.** Place lookup, thumbnails, and search all run on your
  machine. Nothing phones home.
