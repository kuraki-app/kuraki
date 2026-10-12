#!/usr/bin/env bash
set -euo pipefail
output=${1:?provide a disposable installation directory}
mkdir -p "$output"
curl -fsSL --retry 3 --max-time 300 https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip -o "$output/maestro.zip"
expected=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a
actual=$(shasum -a 256 "$output/maestro.zip" | awk '{print $1}')
[ "$actual" = "$expected" ] || { echo 'Maestro checksum mismatch' >&2; exit 1; }
unzip -q "$output/maestro.zip" -d "$output"
