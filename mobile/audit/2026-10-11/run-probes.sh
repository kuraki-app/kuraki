#!/usr/bin/env bash
# Reproduces observed defects; passing here means the unsafe behavior exists.
# These probes intentionally stay outside the application's regression suite.
set -euo pipefail
cd "$(dirname "$0")/../.."
files=(src/lib/mobile-audit.probe.test.ts src/lib/mobile-api-audit.probe.test.ts src/lib/mobile-capture-audit.probe.test.ts)
for file in "${files[@]}"; do
  [ ! -e "$file" ] || { printf 'Refusing to overwrite %s\n' "$file" >&2; exit 1; }
done
cleanup() { rm -f "${files[@]}"; }
trap cleanup EXIT
cp audit/2026-10-11/backup.probe.txt "${files[0]}"
cp audit/2026-10-11/account-and-trip.probe.txt "${files[1]}"
cp audit/2026-10-11/capture.probe.txt "${files[2]}"
npx vitest run "${files[@]}"
