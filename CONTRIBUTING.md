# Contributing to Kuraki

Thanks for your interest in Kuraki! This is an early-stage, solo-maintained project, so a little process keeps things sane. Contributions of all sizes are welcome — bug reports, docs, tests, and code.

## Guiding principles

Kuraki aims to be a focused, self-hosted photo backup you actually enjoy running: near-zero configuration, your originals kept intact on disk, and boring, snapshot-protected upgrades. Before proposing a feature, ask whether it fits that focus. We say no to a lot — see the non-goals in [ROADMAP.md](./ROADMAP.md). When in doubt, open an issue to discuss before writing code.

## Getting started

Requirements: **Go 1.26+** and **Node 20+** (for the web UI). libvips + ffmpeg are optional (only for
the full media pipeline; the default build is pure-Go).

```sh
git clone https://github.com/kuraki-app/kuraki
cd kuraki
./scripts/start.sh   # build UI + binary, run one server on :3000 (production-like)
./scripts/dev.sh     # API (:3000) + Vite UI (:5173) separately, with hot reload
make test            # go test -race ./...
```

**Frontend:** the web UI (`web/`, SvelteKit) is built into `internal/httpapi/assets/` and embedded in
the binary. Use **`./scripts/dev.sh`** while iterating — it runs Vite with hot reload and proxies the
API. Before committing a UI change, run **`make web`** (or `./scripts/start.sh`) so the rebuilt embedded
assets are included; the Go binary serves those, not the Vite dev output.

## Development workflow

1. **Open an issue first** for anything non-trivial, so we agree on scope.
2. Branch from `main`: `git checkout -b feat/short-description`.
3. Keep changes focused; one logical change per PR.
4. Ensure it's green before pushing:
   ```sh
   make fmt      # gofmt
   make vet      # go vet ./...
   make test     # go test -race ./...
   ```
5. Update **[ROADMAP.md](./ROADMAP.md)** checkboxes and **[CHANGELOG.md](./CHANGELOG.md)** (`Unreleased`) when your change lands user-facing behavior.
6. Open a PR against `main` and fill out the template.

## Code style & conventions

- **Formatting:** `gofmt` (enforced). Run `make fmt`.
- **Architecture rule:** `internal/domain` performs **no I/O**. Route file access through `storage.Storage` and image work through `media.Processor`. No direct `os.*` in domain logic.
- **Errors:** wrap with context (`fmt.Errorf("pkg: doing X: %w", err)`).
- **Logging:** structured `log/slog`; no `fmt.Println` in library code.
- **Tests:** table-driven where it helps; cover the behavior, not the implementation. New logic ships with tests.
- **Dependencies:** be conservative. A new dependency needs justification — keep the dependency footprint deliberate.
- **SQL:** migrations are append-only and versioned (`internal/db/migrations`). Never edit a released migration; add a new one.

## Commit messages

Follow a Conventional-Commits-ish style so history stays scannable:

```
type: short imperative summary

Optional body explaining the "why".
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`.

## Reporting bugs

Use the issue templates. Include your platform/arch, how you installed (binary/Docker), the command you ran, logs, and repro steps. For anything touching data safety, note whether originals were affected.

## Security issues

Do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the project's [AGPL-3.0](./LICENSE).
