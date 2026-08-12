#!/usr/bin/env bash
#
# Fails if the documentation points somewhere that does not exist.
#
# This exists because every advertised install path was broken at once and
# nothing noticed: the README cloned a repository under the project's *former*
# name, its CI badge pointed at the same place, and the Docker quickstart named
# an image path that no workflow published. None of it is type-checked, none of
# it is exercised by a test, and all of it is the first thing a stranger runs.
#
# The check is deliberately about *links*, not mentions. Handoff entries in
# AGENTS.md record the old repository name as a matter of history and are
# correct to do so; a URL naming it is a dead link.
#
# Run from the repository root:  scripts/check-docs-links.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The canonical repository, in the two forms documentation refers to it by.
# GitHub redirects the old name forever, so a stale URL degrades rather than
# breaking outright — which is exactly why it went unnoticed, and why this is
# checked mechanically instead of by eye.
readonly OWNER="kuraki-app"
readonly REPO="kuraki"
readonly STALE_NAMES=("kuraki-photos")

readonly SELF="scripts/check-docs-links.sh"
fail=0

note() { printf '  %s\n' "$*"; }
problem() { printf 'FAIL  %s\n' "$*"; fail=1; }

# Tracked, non-binary files, minus this script — which necessarily contains the
# very strings it searches for.
tracked() { git ls-files -- . ':!:'"$SELF"; }

# ---------------------------------------------------------------------------
# 1. No URL names a former repository.
# ---------------------------------------------------------------------------
printf '==> forge URLs\n'
for stale in "${STALE_NAMES[@]}"; do
  hits=$(tracked | xargs grep -InE "(github\.com|ghcr\.io)/${OWNER}/${stale}\b" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    problem "URL names the former repository '${OWNER}/${stale}':"
    printf '%s\n' "$hits" | sed 's/^/        /'
  fi
done
[ "$fail" -eq 0 ] && note "no stale forge URLs"

# ---------------------------------------------------------------------------
# 2. Every concrete image reference is the image the release workflow pushes.
#    `ghcr.io/${{ github.repository }}` in a workflow is resolved by Actions and
#    is correct by construction, so template forms are skipped rather than
#    compared against a literal.
# ---------------------------------------------------------------------------
printf '==> container image references\n'
# A dot is legal inside an image path, so the match also swallows the full stop
# at the end of a sentence; strip trailing punctuation before comparing.
images=$(tracked | xargs grep -hoE 'ghcr\.io/[A-Za-z0-9._/-]+' 2>/dev/null |
  sed -E 's/[.,;:]+$//' | sort -u || true)
for image in $images; do
  case "$image" in
    "ghcr.io/${OWNER}/${REPO}") ;;
    "ghcr.io/") ;;  # the truncated head of a ${{ … }} template
    *) problem "unexpected image '${image}' (expected ghcr.io/${OWNER}/${REPO})" ;;
  esac
done
note "$(printf '%s\n' "$images" | grep -c . || true) distinct image reference(s) checked"

# ---------------------------------------------------------------------------
# 3. Every relative Markdown link resolves to a file that exists.
# ---------------------------------------------------------------------------
printf '==> relative Markdown links\n'
checked=0
while IFS= read -r md; do
  [ -f "$md" ] || continue
  dir=$(dirname "$md")
  # [text](target) — skip absolute URLs, anchors, and mail/telephone schemes.
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    case "$target" in
      http://*|https://*|mailto:*|tel:*|'#'*|'<'*) continue ;;
    esac
    path=${target%%#*}                       # drop any fragment
    [ -n "$path" ] || continue
    checked=$((checked + 1))
    [ -e "$dir/$path" ] || problem "$md → $target (no such file)"
  done < <(grep -oE '\]\([^)]+\)' "$md" | sed -E 's/^\]\(//; s/\)$//')
done < <(tracked | grep -E '\.md$')
note "$checked relative link(s) checked"

# ---------------------------------------------------------------------------
# 4. Every internal link on the marketing site resolves to a real page.
#
#    Check 3 only reads Markdown, so site/ was unguarded by the very script that
#    exists to stop dead links — and the site is the first thing a stranger sees.
#    Routes come from the filesystem: an Astro page at src/pages/download.astro
#    serves /download, and src/content/docs/install.md serves /docs/install via
#    the [...slug] route.
# ---------------------------------------------------------------------------
printf '==> site internal links\n'
if [ -d site/src/pages ]; then
  routes=$(
    {
      # Pages. index.astro is the directory itself; [...slug] is dynamic and is
      # enumerated from the content collection below instead.
      find site/src/pages -name '*.astro' ! -name '*[*' |
        sed -E 's#^site/src/pages##; s#/index\.astro$#/#; s#\.astro$##'
      # Docs entries, served under /docs/<name>.
      find site/src/content/docs -name '*.md' 2>/dev/null |
        sed -E 's#^site/src/content/docs/#/docs/#; s#\.md$##'
      # Static files served from public/ at the root.
      find site/public -type f 2>/dev/null | sed -E 's#^site/public##'
    } | sed -E 's#^$#/#' | sort -u
  )

  site_checked=0
  while IFS= read -r page; do
    [ -f "$page" ] || continue
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      case "$target" in
        http://*|https://*|mailto:*|tel:*|'#'*|'data:'*|'{'*) continue ;;
      esac
      path=${target%%#*}
      path=${path%/}
      [ -n "$path" ] || continue
      site_checked=$((site_checked + 1))
      # A trailing-slash and a bare form are the same route here.
      if ! printf '%s\n' "$routes" | grep -qxE "${path}/?"; then
        problem "$page → $target (no such page; routes come from site/src/pages and site/src/content/docs)"
      fi
    done < <(grep -oE 'href="/[^"]*"' "$page" | sed -E 's/^href="//; s/"$//')
  done < <(tracked | grep -E '^site/src/.*\.(astro|md)$')
  note "$site_checked internal site link(s) checked"
else
  note "no site/ directory — skipped"
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf 'check-docs-links: OK\n'
else
  printf 'check-docs-links: FAILED\n'
fi
exit "$fail"
