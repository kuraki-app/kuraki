<!-- Thanks for contributing to Kuraki! -->

## What & why

<!-- What does this change do, and what problem does it solve? Link the issue: Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Docs
- [ ] CI / tooling

## Checklist

- [ ] `make check` passes (fmt, vet, `go test -race ./...`)
- [ ] Fits Kuraki's scope (or discussed in an issue first)
- [ ] `internal/domain` still does no I/O; file/image access goes through interfaces
- [ ] New migrations are additive (never edited a released migration)
- [ ] If `web/` changed, ran `npm run build` so the embedded UI (`internal/httpapi/assets`) is updated
- [ ] Updated `CHANGELOG.md` (Unreleased) and `ROADMAP.md` if user-facing
- [ ] Added/updated tests

## Notes for reviewer

<!-- Anything about data safety, performance and resource use, or trade-offs. -->
