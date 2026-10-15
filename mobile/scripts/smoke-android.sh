#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
qa_output=${1:?Provide the CI temporary output directory}
qa_device=${ANDROID_SERIAL:-emulator-5554}
if [[ "$qa_device" != emulator-* ]]; then
  echo 'Native smoke tests require a disposable emulator, never a physical phone.' >&2
  exit 1
fi

mkdir -p "$qa_output/mobile-smoke-logs/adb"
collect_diagnostics() {
  local result=$?
  timeout 15s adb -s "$qa_device" logcat -d -t 2000 > "$qa_output/mobile-smoke-logs/adb/logcat.txt" 2>&1 || true
  timeout 15s adb -s "$qa_device" shell dumpsys mount > "$qa_output/mobile-smoke-logs/adb/mount.txt" 2>&1 || true
  timeout 15s adb -s "$qa_device" shell dumpsys storage > "$qa_output/mobile-smoke-logs/adb/storage.txt" 2>&1 || true
  return "$result"
}
trap collect_diagnostics EXIT

python3 scripts/create-smoke-photo.py "$qa_output/native-proof.png"
# Boot completion and directory existence do not prove that MediaProvider's
# shared-storage filesystem can write. Require a successful bounded probe.
storage_ready=false
for attempt in $(seq 1 30); do
  if timeout 10s adb -s "$qa_device" shell 'mkdir -p /sdcard/Pictures && echo ready > /sdcard/Pictures/.kuraki-storage-probe && rm /sdcard/Pictures/.kuraki-storage-probe'; then
    storage_ready=true
    break
  fi
  sleep 2
done
if [ "$storage_ready" != true ]; then
  echo 'Android shared media storage did not become writable.' >&2
  exit 1
fi
# An ADB sync connection can reset just after boot; never accept a missing file.
fixture_ready=false
for attempt in 1 2 3; do
  if timeout 20s adb -s "$qa_device" push "$qa_output/native-proof.png" /sdcard/Pictures/native-proof.png; then
    fixture_ready=true
    break
  fi
  sleep 2
done
if [ "$fixture_ready" != true ]; then
  echo 'Android synthetic media fixture transfer failed.' >&2
  exit 1
fi
adb -s "$qa_device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/native-proof.png
adb -s "$qa_device" install android/app/build/outputs/apk/release/app-release.apk
# Warm the native driver before starting the disposable server.
"$qa_output/mobile-ui/maestro/bin/maestro" --device "$qa_device" test --debug-output "$qa_output/mobile-driver-logs" .maestro/launch.yaml
node scripts/start-smoke-server.mjs "$qa_output/mobile-smoke.env"
. "$qa_output/mobile-smoke.env"
"$qa_output/mobile-ui/maestro/bin/maestro" --device "$qa_device" test --debug-output "$qa_output/mobile-smoke-logs" -e SERVER_URL=http://10.0.2.2:39218 .maestro/onboarding.yaml
python3 scripts/check-smoke-import.py "$SMOKE_SERVER_DIR"
