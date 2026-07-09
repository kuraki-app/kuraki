# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from v1.0.0 onward (pre-1.0 is unstable and may change).

## [Unreleased]

### Added — M0 scaffold
- Zero-config server (`kuraki serve`): sensible defaults for data dir, port, and DB location; `KURAKI_*` env + flag overrides.
- SQLite (WAL) via pure-Go `modernc.org/sqlite`, embedded versioned `goose` migrations, and schema v1 (users, assets, derivatives, albums, sessions, import_state, change_log, FTS5).
- Automatic pre-migration database snapshot (`VACUUM INTO`) for safe upgrades.
- `Storage` interface with a write-once, atomic, traversal-safe filesystem implementation.
- `Processor` interface with a pure-Go media backend (libvips backend behind `-tags vips`, to follow).
- Cobra CLI: `serve`, `import` (stub), `verify` (stub), `version`.
- HTTP layer (chi): `/healthz`, `/api/status`, embedded UI shell with SPA fallback.
- Dockerfile (runtime bundles libvips + ffmpeg), `.dockerignore`, and GitHub Actions CI (test/race, cross-compile matrix, GHCR image).
- Project docs: README, ROADMAP tracker, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates, Makefile.

### Added — M1 core alpha
- CLI bulk import (`kuraki import`): recursive walk, BLAKE3 content-hash dedup, EXIF-date `originals/YYYY/MM/` organization, resume via `import_state`, `--dry-run`, progress output, bounded thumbnail/poster worker pool.
- Media pipeline: pure-Go JPEG thumbnails + EXIF probe; libvips WebP backend behind `-tags vips`; ffmpeg video posters.
- Web API (chi): cursor-paginated day/month timeline, asset detail, original + thumbnail serving, FTS5 search (prefix matching) with date/type/camera filters.
- Auth: first-run admin setup, argon2id password hashing, HttpOnly/SameSite session cookies.
- Embedded SvelteKit SPA (virtualized timeline, photo viewer) built into the binary; Docker Node build stage.

### Added — M2 beta hardening
- `kuraki verify`: re-checksums originals, reports mismatch/missing with expected/actual hash, non-zero exit on problems.
- Trash (F-10): soft-delete to `trash/` with 30-day retention, restore, `GET /api/trash`, and a startup + daily purge janitor.
- Video (F-13): browser upload via `POST /api/assets`, HTTP Range support on originals for in-browser seeking.
- Login rate limiting (F-14): per-IP token bucket on `/api/login`.
- Real `/metrics`: runtime memory/goroutines/uptime plus library asset counts and size.

[Unreleased]: https://github.com/kuraki-app/kuraki/commits/main
