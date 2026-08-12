---
title: Configuration
description: Kuraki is zero-config by default. Every setting has an environment variable, and the ones that matter are editable in the UI.
order: 40
---

Kuraki runs with no configuration at all. Settings resolve in the order **defaults → database →
environment/flags**, so anything set in the environment wins and is shown as pinned in the UI rather
than silently ignored.

Most day-to-day settings are editable in **Settings → Library** and **Settings → Server**, which also
tells you which changes apply immediately and which need a restart.

| Flag | Environment | Default | What it does |
|---|---|---|---|
| `--data-dir` | `KURAKI_DATA_DIR` | `./kuraki-data` | Library root: database, originals, derivatives, trash, snapshots |
| `--addr` | `KURAKI_ADDR` | `:3000` | HTTP listen address |
| — | `KURAKI_TRASH_RETENTION_DAYS` | `30` | Days a trashed item stays restorable before it is purged |
| — | `KURAKI_THUMBNAIL_SIZE` | `512` | Thumbnail longest edge, in pixels |
| — | `KURAKI_OCR` | off | Opt-in local text recognition in images (needs `tesseract` on PATH) |
| — | `KURAKI_CHANGELOG_KEEP` | `100000` | Change-log rows kept for the delta-sync feed |
| — | `KURAKI_SECURE_COOKIES` | off | Mark the session cookie `Secure` — turn on behind HTTPS |
| — | `KURAKI_TRUST_PROXY` | off | Trust `X-Forwarded-For` — **only** behind a proxy you control |
| — | `KURAKI_METRICS_TOKEN` | — | Bearer token for scrapers reading `/metrics` |
| — | `KURAKI_BACKUP_DIR` | — | Enable unattended backups; keep it on a **separate disk** |
| — | `KURAKI_BACKUP_INTERVAL_HOURS` | `24` | How often an unattended backup runs |
| — | `KURAKI_BACKUP_KEEP` | `7` | How many automatic archives to retain |
| — | `KURAKI_ANDROID_APK` | `<data>/downloads/kuraki-android.apk` | APK served at `/download/android` |

`KURAKI_ANDROID_APK` is environment-only on purpose: `/download/android` is a public endpoint, so the
path it serves should not be editable from a web session.
