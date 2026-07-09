# Contributing to Kuraki

Thanks for your interest in Kuraki! This is an early-stage, solo-maintained project, so a little process keeps things sane. Contributions of all sizes are welcome — bug reports, docs, tests, and code.

## Guiding principles

Kuraki exists to be **light**. Before proposing a feature, ask whether it fits the thesis: *single binary, near-zero config, plain-filesystem storage, runs on a Pi, boring upgrades*. Weight is the product. We say no to a lot — see the Non-Goals in the PRD. When in doubt, open an issue to discuss before writing code.

## Getting started

Requirements: **Go 1.26+**. libvips + ffmpeg are optional (only for the full media pipeline; the default build is pure-Go).

```sh
git clone https://github.com/saranshh/kuraki
cd kuraki
make build       # -> ./bin/kuraki
make run         # build + serve on :3000
make test        # go test -race ./...
```

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
- **Dependencies:** be conservative. A new dependency needs justification — weight is the product.
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
