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

[Unreleased]: https://github.com/saranshhardaha/kuraki/commits/main
