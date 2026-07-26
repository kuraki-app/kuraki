# Migrating into Kuraki

Moving a photo library between servers usually costs you everything that is not
baked into the image bytes — albums, favorites, ratings, captions, archive state.
This guide covers moving a library into Kuraki without that loss.

- [From Immich](#from-immich) — supported today, over the Immich REST API
- [From Google Photos](#from-google-photos) — partial support today via Takeout sidecars

---

## From Immich

Kuraki reads your Immich library through Immich's public REST API. Nothing is
written back to Immich, and your Immich server keeps working throughout — you can
run both side by side until you are satisfied with the result.

### What transfers

| Immich | Becomes in Kuraki |
| --- | --- |
| Original file | The original, stored write-once under `originals/YYYY/MM/` |
| Capture time (`localDateTime`) | `taken_at` — drives the timeline and storage path |
| GPS coordinates | `gps_lat` / `gps_lon`, then place names from Kuraki's offline geocoder |
| Camera make & model | `camera_make` / `camera_model` |
| Description | Asset description, full-text searchable |
| Favorite | Favorite |
| Rating (0–5) | Rating |
| Archived (`visibility: archive`) | Archived |
| Hidden (`visibility: hidden`) | Hidden |
| Albums, including descriptions | Albums, with membership |
| Tags, including nesting | Tags, with the same parent/child hierarchy |
| Stacks | Stacks, with the same primary |
| Live / motion photos | The still and its video, stacked together |
| Trashed assets (with `--include-trashed`) | Kuraki's trash |

Place names are deliberately **not** copied from Immich. Kuraki re-derives them
from the coordinates with its own offline geocoder, so migrated photos sort and
filter identically to ones imported natively.

### What does not transfer

Be clear-eyed about this before you switch over.

| Immich feature | Why it cannot come across |
| --- | --- |
| **People and faces** | Kuraki has no face recognition and no people/faces tables at all. Named people are lost. |
| **Smart search** | Immich's CLIP embeddings have no equivalent; Kuraki's search is filename, camera, date, description and OCR text. |
| **Memories** | Kuraki builds "On this day" from capture dates instead; Immich's curated memories have no target. |
| **Shared links, partner sharing, album sharing** | Kuraki is single-user today. Albums migrate as owned by the target account. |
| **Comments and activity** | No equivalent. |
| **Immich's edits** | Kuraki fetches the untouched original, matching its write-once originals rule. An edited version in Immich is not carried over. |
| **Checksums** | Immich uses SHA-1, Kuraki BLAKE3. Kuraki re-hashes everything; its own duplicate detection is unaffected. |

Assets Immich reports as `AUDIO`, `OTHER`, offline, or inside the PIN-locked
folder are skipped and counted, with the reason recorded — never silently dropped.

### Before you start

1. **Create an Immich API key.** In Immich: your avatar → *Account Settings* →
   *API Keys* → *New API Key*. It needs read and download permission on assets.
2. **Check disk space.** Kuraki stores its own copy of every original, plus
   thumbnails. Budget slightly more than your Immich `UPLOAD_LOCATION/library` and
   `upload` folders combined.
3. **Keep Immich running** until you have verified the result. Nothing about this
   process modifies or deletes anything on the Immich side.

### Run it

Look before you leap:

```sh
kuraki migrate immich \
  --url https://immich.example \
  --api-key "$IMMICH_KEY" \
  --dry-run
```

That prints what would be migrated and writes nothing. Then run it for real:

```sh
kuraki migrate immich \
  --url https://immich.example \
  --api-key "$IMMICH_KEY"
```

In Docker:

```sh
docker compose exec kuraki kuraki migrate immich \
  --url https://immich.example --api-key "$IMMICH_KEY"
```

To keep the key out of your shell history, set `KURAKI_IMMICH_URL` and
`KURAKI_IMMICH_API_KEY` instead of passing the flags.

Useful options:

| Flag | Default | Effect |
| --- | --- | --- |
| `--include-trashed` | off | Also migrate trashed assets into Kuraki's trash |
| `--albums` / `--tags` / `--stacks` | on | Turn off to migrate assets only |
| `--since <RFC3339>` | — | Only assets captured at or after this time; useful for topping up |
| `--parallel` | 4 | Concurrent downloads |
| `--batch` | 250 | Assets downloaded and imported per batch |
| `--owner` | `owner` | Which Kuraki account receives the library |

### Progress, interruptions, and resuming

The migration works in batches: it downloads a batch of originals into staging,
imports them, wires up albums and tags, then deletes the staged copies and
records a checkpoint. Disk use stays bounded no matter how large the library is,
and a migration in flight shows up in the web UI's Activity view.

Every transferred item is recorded, so **re-running the same command is always
safe** — it imports nothing twice and only retries what previously failed.

```sh
kuraki migrate status              # all runs
kuraki migrate status <run-id>     # one run in detail
```

If a run is interrupted, resume it:

```sh
kuraki migrate immich --resume <run-id> \
  --url https://immich.example --api-key "$IMMICH_KEY"
```

**The API key is never stored in Kuraki's database.** That is deliberate — a
replayable credential sitting in `kuraki.db` is a liability, and Kuraki already
moved device pairing codes from plaintext to hashes for the same reason. The
consequence is honest: if the server restarts mid-migration, the run cannot pick
itself back up unattended. It is marked failed with the exact resume command, and
resuming re-downloads nothing.

### Verify the result

```sh
kuraki migrate status <run-id>     # imported / duplicates / skipped / errors
kuraki verify                      # re-checksum every stored original
```

Then spot-check in the web UI: open the timeline and confirm the date range
matches, open an album, and check a favorited and an archived photo.

If `errors` is above zero, the run prints the command to retry just those items.
Per-item failures are recorded individually and never abort the whole migration.

### Troubleshooting

**`authentication failed (HTTP 401)`** — the API key is wrong, expired, or lacks
asset read/download permission. Migration aborts immediately rather than failing
once per asset.

**Assets counted as duplicates** — Kuraki already had those exact bytes. This is
normal on a re-run, and normal if you previously imported the same files by hand.
Duplicates are still filed into their albums and tags.

**Slow migration** — every original crosses the network. Raise `--parallel` if
your Immich server and network can take it.

**Some assets skipped** — check the reason:

```sh
sqlite3 kuraki-data/kuraki.db \
  "SELECT source_id, error FROM migration_map WHERE status = 'skipped';"
```

---

## From Google Photos

Google Photos has no API suitable for a bulk library export, so migration goes
through **Google Takeout**. Request a Takeout export of Google Photos, unpack it,
and import the folder:

```sh
kuraki import /path/to/Takeout/Google\ Photos
```

Kuraki reads Takeout's JSON sidecars automatically, so these survive:

- Capture time (`photoTakenTime`) — authoritative over EXIF, which Takeout often strips
- GPS coordinates, then place names from Kuraki's offline geocoder
- Description / caption
- Favorites

It tolerates Google's several sidecar naming conventions, including the truncated
`supplemental-metadata` names, by indexing each folder on the sidecar's `title`
field.

**Not yet handled:** albums (Takeout expresses them as folder structure plus a
separate album JSON), archived state, and trashed items. Google does not export
face groupings in a usable form at all.

These gaps are the next thing to close. The migration engine added for Immich is
source-agnostic — a source only has to enumerate items, hand over their metadata,
and stream bytes (`migrate.Source` in `internal/migrate/source.go`) — so a
Takeout source will slot in alongside `internal/migrate/immich` and get batching,
resume, and album/tag/stack wiring for free.

---

## For developers

The migration engine lives in `internal/migrate`, with the Immich client in
`internal/migrate/immich`. Adding another source means implementing
`migrate.Source` — enumerate, describe, fetch — and everything else is handled.

Externally-known metadata reaches the importer through
`importer.MetadataProvider`; when a caller supplies none, the importer falls back
to Google Takeout sidecar resolution, which is how plain `kuraki import` behaves.

`migration_map` records every source-id → local-id association, keyed on
`(owner, source, kind, source_id)`. That is what makes re-runs idempotent and
resume cheap.
