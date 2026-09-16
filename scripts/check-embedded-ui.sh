#!/usr/bin/env bash
# check-embedded-ui.sh — fail when the committed embedded UI (internal/httpapi/assets)
# does not match a fresh `make web` build. Run it right after building.
#
# Every file is compared byte for byte except the precompressed `.gz` copies.
# Node's zlib writes a platform-specific gzip header (OS byte) and uses
# CPU-specific deflate code, so a Mac-built `.gz` never equals a Linux-built one
# even when the content is identical. For those, what must hold is that each
# `.gz` still decompresses to exactly its sibling file — a stale one does not.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
dir=internal/httpapi/assets
status=0

# Any added, deleted or untracked file, or any modified file other than a `.gz`,
# means the build output changed.
changes=$(git status --porcelain --untracked-files=all -- "$dir" | grep -v -E '^ M .*\.gz$' || true)
if [ -n "$changes" ]; then
  echo "Embedded UI differs from a fresh build:"
  echo "$changes"
  status=1
fi

# Each precompressed copy must decompress to its source file.
while IFS= read -r -d '' gz; do
  src="${gz%.gz}"
  if [ ! -f "$src" ]; then
    echo "stale: $gz has no source file $src"
    status=1
  elif ! gzip -dc -- "$gz" | cmp -s - "$src"; then
    echo "stale: $gz does not decompress to $src"
    status=1
  fi
done < <(find "$dir" -type f -name '*.gz' -print0)

if [ "$status" -ne 0 ]; then
  echo
  echo "ERROR: internal/httpapi/assets is stale."
  echo "The committed UI does not match a fresh build of web/."
  echo "Run 'make web' and commit the result."
fi
exit "$status"
