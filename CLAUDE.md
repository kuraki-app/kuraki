# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion doc

`AGENTS.md` is the authoritative, continuously-updated coordination file for this repo — current state (§2), locked decisions (§3), the progress ledger (§8), and the handoff log (§11). **Read it before starting nontrivial work, and update §2/§8/§11 in the same commit that finishes a unit of work.** This file is the stable orientation; AGENTS.md is the living state.

## What this is

Kuraki is a self-hosted photo & video backup server (AGPL-3.0). A single Go binary embeds a SvelteKit SPA and serves the whole app from one port — including in Docker (see Runtime shape below). There is also an Expo/React Native mobile client (`mobile/`) for camera-roll backup and library browsing. Three surfaces — `internal/` (Go server), `web/` (SvelteKit), `mobile/` (Expo) — are all CI-gated, and the two clients are wired to the server through a **generated API contract** (see below). A fourth, `site/`, is the public marketing + docs site (Astro, static output, deployed separately to Cloudflare Pages).

## Commands

Backend (from repo root, via `Makefile`):

```sh
make check        # fmt + vet + test — run before every commit
make test         # go test -race ./...
make build        # pure-Go binary -> ./bin/kuraki (CGO_ENABLED=0)
make build-vips   # libvips backend (needs libvips-dev + pkg-config; -tags vips)
make dev          # API :3000 + Vite UI :5173, hot reload (scripts/dev.sh) — open :5173
make start        # build web + binary, one production-like process on :3000
make e2e          # web + build + Playwright against a real seeded server (see below)
make gen          # regenerate OpenAPI contract + web/mobile TS types (see below)
make check-gen    # what CI runs: gen, then fail if the committed artifacts moved
```

Security scan (not wired into CI; run it when touching dependencies):
`go run golang.org/x/vuln/cmd/govulncheck@latest ./...` — must report zero.

Run a single Go test: `go test -race ./internal/importer -run TestName`.
Note: `make` targets use `GO_PACKAGES` (`go list ./...` minus `node_modules`) — Expo fixtures under `mobile/` contain Go files that must not be treated as project packages. (`make check` uses it; CI runs bare `./...`.)

Web (`cd web`): `npm run dev` (Vite, proxies /api to :3000) · `npm run build` (outputs embedded assets into `internal/httpapi/assets` via `go:embed`) · **`npm run check` (svelte-check) — `build` does NOT typecheck, this is the only type gate** · `npm run test` (Vitest, pure logic in `src/lib` only) · `npm run test:e2e` (Playwright; prefer `make e2e`, which rebuilds first).

Run one browser test: `cd web && npx playwright test <file-substring>` — e.g. `npx playwright test viewer`. Add `--ui` to step through it.

Site (`cd site`): `npm run build` (Astro → `site/dist`) · `npm run check-tokens` (fails if the site palette drifts from `web/src/app.css`) · `npm run check-fonts` (fails if the vendored woff2 stop matching `web/node_modules`).

Mobile (`cd mobile`): `npm run ios` / `npm run android` · `npm run lint` (`expo lint`) · `npx tsc --noEmit` · `npm run test` (Vitest, pure logic only) · `npm run check-tokens` (design-token drift gate).

**CI (`.github/workflows/ci.yml`) gates seven jobs:** vet+`go test -race`, **API contract up to date** (`make check-gen`), web `npm run check` + `build`, mobile `tsc --noEmit` + `expo lint` + `npm run test` + `npm run check-tokens`, pure-Go cross-compile, Docker image, and a **media-contract job** that installs libvips and runs `CGO_ENABLED=1 go test -race -tags vips ./...`. That last one is the only place `-tags vips` code is exercised (this machine has no libvips), so treat `vips.go` changes as untestable locally — build them in Docker or expect CI to be the first check. Some tests self-skip when `ffmpeg`/`tesseract` are absent rather than failing.

## Generated artifacts (never hand-edit — regenerate and commit)

Three files are machine-generated and CI-gated; editing them by hand fails the build.

| File | Generated from | Command |
|---|---|---|
| `internal/httpapi/apispec/openapi.json` | swag annotations on the handlers + `internal/httpapi/apitypes` | `make openapi` |
| `web/src/lib/api.gen.ts`, `mobile/src/lib/api.gen.ts` | the OpenAPI JSON above | `make client-types` |
| `mobile/src/design/tokens.ts` | `web/src/app.css` (`:root` + `.dark` blocks) | `cd mobile && npm run sync-tokens` |

So: **touching a handler signature or an `apitypes` struct means running `make gen` and committing the diff**, and **touching the palette in `web/src/app.css` means running `npm run sync-tokens`**. The palette is additionally WCAG-gated by `web/scripts/check-contrast.py`, which parses `app.css` directly. Generator versions are pinned in the `Makefile` so `check-gen` can't fail spuriously.

## Verifying web changes

`make e2e` boots the **Go binary** (not `vite dev`) against a throwaway seeded library and drives it with Playwright. It is the only gate that sees runtime behaviour: `npm run build` does not typecheck, and `svelte-check` cannot see a component throwing on mount. A console-error guard fails any test on `console.error`/`pageerror`, so a test that navigates and asserts nothing still earns its keep.

Four things about this loop bite repeatedly:

- **A running `kuraki serve` keeps serving the assets it started with.** `go:embed` bakes them in, so after `make web build` you must restart the server or you are testing the old UI. `web/e2e/server.mjs` refuses to start when `web/src` is newer than the binary, which catches the `npm run build`-only case but not a stale *process*.
- **Seeding order is load-bearing.** `kuraki import` creates a placeholder owner row, and `POST /api/setup` *claims* it — so the suite imports first and runs first-run setup through the UI afterwards. Reversed, you sign in to an empty library.
- **Fixtures must be byte-distinct.** The importer deduplicates on BLAKE3, so N copies of one image import as one asset and every count assertion passes vacuously. `web/e2e/fixtures.mjs` varies pixels and asserts the imported count; `internal/httpapi/pagination_test.go` hit the same trap.
- **Wait for the skeleton before measuring geometry.** `LibraryView` crossfades the placeholder out over 240ms, so both grids are briefly in the DOM with the real one *below*. Measuring then reports the first photo ~1780px down a page whose header is 170px.

**Tests catch regressions; they do not catch design problems.** Prose set in the data face, an empty state with no action, a description that became false — all shipped through a fully green suite and were only found by screenshotting a page and reading it. Look at what you changed.

## Architecture

**Composition root: `internal/app`** wires every package together, owns the server lifecycle and background workers (import queue, trash-purge janitor, integrity scheduler, capture-session janitor). Start here to trace how a request or job flows.

**Layering / dependency direction:**
- `internal/domain` — core entities, **no I/O ever** (no `os`, `database/sql`, `net`). File access goes through `storage.Storage`; image work through `media.Processor`.
- `internal/storage` — `Storage` interface + write-once, atomic, traversal-safe FS impl. `FS.Write` refuses overwrite (`ErrExists`).
- `internal/db` — `modernc.org/sqlite` (pure-Go, WAL, FTS5), perf pragmas, goose migrations (embedded, **append-only**), auto-snapshot before every schema change. Keep this layer CGO-free.
- `internal/media` — `Processor` interface with a pure-Go fallback (`purego.go`) and a libvips backend behind `//go:build vips` (`vips.go`); ffmpeg posters/transcodes; EXIF; perceptual hashing.
- `internal/httpapi` — chi router, handlers, middleware; `assets/` holds the embedded built UI, `apitypes/` the DTOs, `apispec/` the generated contract. Filters live in `filters.go` (`parseAssetFilters` + `respondFiltered`) — the one filter language behind `/api/search` and the device read endpoints; add a filter there and web + mobile both get it.
- `internal/config` — `Store` resolves settings **defaults < DB < env/flags** and marks each value live vs restart-required; `internal/serversettings` is the DB half (owner-writable catalog, migration `00022`). Env-only settings stay env-only on purpose (e.g. `android_apk`, because `/download/android` is public).
- Feature packages: `importer` (recursive import, BLAKE3 dedup, resume, derivatives, Takeout+geocode), `queue` (background import jobs with retry/backoff/crash recovery), `takeout`, `migrate` (Immich library import, `immich/` sub-adapter), `geo` (offline reverse geocoding, embedded GeoNames), `trash`, `verify`, `auth` (argon2id + sessions), `ocr` (opt-in tesseract via exec), `duplicates`, `stacks`, `backup`, `external`.

**The web UI has two registers, and the seam is a rule.** `web/src/app.css` defines one palette driven by two sets of `--frame-*`/`--space-step` tokens: **Kura** (8px rhythm, Fraunces headings, soft cards — photo pages) and **Vault** (4px rhythm, mono data, hairline panels — operational pages). `nav.ts` assigns the register per route and `+layout.svelte` writes it to `data-register` on `<main>`.

**The register belongs to the page frame, never to the photo components.** `AssetGrid` and `Viewer` render in Kura whatever page hosts them — Trash and Duplicates are Vault *frames* around a Kura grid. This is why register-specific styling is opt-in components (`SectionHeading`) rather than `[data-register='vault'] h2`: `AssetGrid` renders day headers as `<h2>`, and an element selector would restyle photographs' headings. `web/e2e/registers.spec.ts` pins the seam from both sides. Spacing uses **integer multiples of `--space-step` only** — a fractional multiplier lands off-rhythm in both registers at once.

**Two auth principals, one handler.** Web uses session cookies; mobile uses device tokens (`/api/capture/*`). Shared handlers resolve the owner through the `ownerID(r)` bridge under `requirePrincipal` — when adding an endpoint mobile needs, mount the same handler on both trees rather than forking it. Every asset mutation must also write to `change_log` (owner-scoped, cursor-paginated), which is what `GET /api/changes` + `/api/capture/changes` replay for delta sync.

**Data dir layout** (everything the library needs lives under `KURAKI_DATA_DIR`): `kuraki.db` (metadata + pointers only) · `originals/YYYY/MM/` (write-once) · `derivatives/<id>/` (thumbs, posters, transcodes) · `staging/` (uploads awaiting the queue) · `trash/` (retention window) · `snapshots/` (pre-migration DB copies). The DB stores pointers, never bytes.

**CLI: `cmd/kuraki`** (cobra, all in `main.go`) — `serve` / `import` / `verify` / `backup` / `restore` / `passwd` / `healthcheck` / `version`. `passwd` resets a password offline and is the recovery path when locked out of the web UI; `healthcheck` is the container's HEALTHCHECK probe.

**Runtime shape in Docker:** one container, one process, one origin. `scripts/docker-entrypoint.sh` `exec`s `kuraki serve` on `:3000`, which serves the API, media, `/healthz`, `/metrics`, `/download/*`, and the embedded SvelteKit UI (including first-run setup) — all from a single origin. The UI boots under the strict CSP via a per-request script nonce (`spaHandler`/`serveSPADocument` in `internal/httpapi`); there is no in-container Caddy. Any non-`serve` argument passes straight through to the CLI, which is why `docker compose exec kuraki kuraki import …` still works. For internet exposure, front the container with the HTTPS reverse proxy in `deploy/` (which proxies to `:3000`).

## Invariants (violating these is a bug)

1. `internal/domain` performs no I/O.
2. **Originals are write-once** — never modify/rename/delete an original after import; keep `FS.Write`'s overwrite refusal.
3. **Migrations are append-only** — never edit a released `0000N_*.sql`; add a new one. Every schema change must be safe under the auto-snapshot.
4. **DB/storage/domain stay CGO-free.** libvips CGO is confined to `media` behind `-tags vips`.
5. **Default build must stay pure-Go** — `go build ./...` (no tags) always succeeds without libvips. Anything needing libvips goes behind `//go:build vips`.
6. Structured logging only (`log/slog`); wrap errors with context (`fmt.Errorf("pkg: doing X: %w", err)`).
7. **Generated artifacts are never hand-edited** — regenerate via the table above and commit the result.
8. **Every asset query is owner-scoped**, enforced mechanically by `ownerscope_guard_test.go`, which fails the build on unscoped asset SQL. **Know what that guard cannot see:** it reads query text, so a *correctly* scoped query pointed at attacker-chosen files passes it. That was a real vulnerability — any signed-in user could name a `root_path` and have `external.Scan` index another owner's originals as their own. Any endpoint taking a filesystem path is server administration: gate it with `requireOwner` *and* refuse paths inside the data directory.

## Build tags & environment

Default build is `CGO_ENABLED=0` pure-Go; `-tags vips` (CGO on) adds the libvips backend for broader image decoding (HEIC/AVIF/etc.). **libvips is not installed on this dev machine; ffmpeg is** — use Docker or install `libvips-dev` for the vips build. The Docker image bundles libvips + ffmpeg + tesseract.

Config is zero-config with `KURAKI_*` env overrides (`internal/config`; precedence defaults < env < flags). Full table in README; the ones that change behavior most: `KURAKI_DATA_DIR` (`./kuraki-data`), `KURAKI_ADDR` (`:3000`), `KURAKI_TRASH_RETENTION_DAYS` (`30`), `KURAKI_THUMBNAIL_SIZE` (`512`), `KURAKI_OCR` (`off`), `KURAKI_SECURE_COOKIES` (`off`), `KURAKI_TRUST_PROXY` (`off` — trusting `X-Forwarded-For` when *not* behind a proxy silently weakens the login rate limit), `KURAKI_METRICS_TOKEN`, `KURAKI_BACKUP_DIR`/`_INTERVAL_HOURS`/`_KEEP` (unattended backups), `KURAKI_ANDROID_APK`.

## Conventions

- One logical change per branch/commit; branch from `main` (`feat/…`, `fix/…`). Commit style: `type: imperative summary`.
- **No `Co-Authored-By` trailer on commits here** — this deliberately overrides AGENTS.md §10.
- `make check` must pass before committing; if you touched handlers/`apitypes` or the palette, `make check-gen` too. This repo has favored **batching changes** (avoid tiny sub-8-file commits unless told).
- Never commit `docs/` or `kuraki-data/` (both gitignored). **`docs/` matches a directory of that name at any depth** — `site/src/content/docs` and `site/src/pages/docs` are explicitly un-ignored, and were silently left out of a commit before that was added. Check `git status` after `git add -A`.
- Locked decisions (§3 of AGENTS.md) — Go+embedded UI, SvelteKit adapter-static SPA, pure-Go sqlite, goose, media behind `Processor`, UUIDv7 PKs — are not to be relitigated without human sign-off.
