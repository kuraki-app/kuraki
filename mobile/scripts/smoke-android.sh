#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
qa_output=${1:?Provide the CI temporary output directory}

python3 scripts/create-smoke-photo.py "$qa_output/native-proof.png"
adb push "$qa_output/native-proof.png" /sdcard/Pictures/native-proof.png
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/native-proof.png
adb install android/app/build/outputs/apk/release/app-release.apk
# Warm the native driver before minting the short-lived pairing code.
"$qa_output/mobile-ui/maestro/bin/maestro" test --debug-output "$qa_output/mobile-driver-logs" .maestro/launch.yaml
node scripts/start-smoke-server.mjs "$qa_output/mobile-smoke.env"
. "$qa_output/mobile-smoke.env"
"$qa_output/mobile-ui/maestro/bin/maestro" test --debug-output "$qa_output/mobile-smoke-logs" -e SERVER_URL=http://10.0.2.2:39218 -e PAIR_CODE="$PAIR_CODE" .maestro/onboarding.yaml
python3 scripts/check-smoke-import.py "$SMOKE_SERVER_DIR"
