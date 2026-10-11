#!/usr/bin/env bash
# Exercise one exact release image using disposable named volumes only.
set -euo pipefail
image=${1:?usage: scripts/smoke-deployment.sh IMAGE}
image=$(docker image inspect --format '{{.Id}}' "$image")
task_dir=$(mktemp -d)
prefix="kuraki-proof-$(date +%s)-$$"
data_volume="${prefix}-data"
backup_volume="${prefix}-backups"
restore_volume="${prefix}-restore"
server="${prefix}-server"
restored="${prefix}-restored"

cleanup() {
  if [ "$?" -ne 0 ]; then docker logs "$server" 2>/dev/null || true; fi
  docker rm -f "$server" "$restored" >/dev/null 2>&1 || true
  docker volume rm "$data_volume" "$backup_volume" "$restore_volume" >/dev/null 2>&1 || true
  rm -rf "$task_dir"
}
trap cleanup EXIT
for volume in "$data_volume" "$backup_volume" "$restore_volume"; do docker volume create "$volume" >/dev/null; done
# Provision only these freshly created test volumes for the shipped service UID.
docker run --rm --user 0:0 --entrypoint sh \
  -v "$data_volume:/data" -v "$backup_volume:/backups" -v "$restore_volume:/restore-root" \
  "$image" -c 'chown 10001:10001 /data /backups /restore-root' >/dev/null

docker run -d --name "$server" -p 127.0.0.1::39170 \
  -v "$data_volume:/data" -v "$backup_volume:/backups" \
  -e KURAKI_ADDR=:39170 -e KURAKI_DATA_DIR=/data "$image" >/dev/null
origin="http://$(docker port "$server" 39170/tcp | head -1)"
wait_healthy() {
  local url=$1
  for _ in $(seq 1 60); do
    if curl -fsS "$url/healthz" >/dev/null; then return; fi
    sleep 1
  done
  printf 'server did not become healthy\n' >&2
  docker inspect --format '{{json .State}}' "$server" >&2 || true
  docker logs "$server" >&2 || true
  return 1
}
wait_healthy "$origin"
curl -fsS -c "$task_dir/cookies" -H 'Content-Type: application/json' \
  -d '{"username":"proof","password":"deployment-proof-password"}' \
  "$origin/api/setup" > "$task_dir/setup.json"
owner=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["user"]["id"])' "$task_dir/setup.json")
python3 - "$task_dir/photo.png" "$task_dir/device.png" <<'PY'
import struct, sys, zlib
def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
for path, color in zip(sys.argv[1:], ([30,90,180],[180,90,30])):
    pixels=b''.join(b'\0'+bytes(color)*8 for _ in range(8))
    image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',8,8,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')
    open(path,'wb').write(image)
PY
curl -fsS -b "$task_dir/cookies" -H "X-Kuraki-Owner-ID: $owner" \
  -F "file=@$task_dir/photo.png" "$origin/api/assets" > "$task_dir/job.json"
job=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["job_id"])' "$task_dir/job.json")
wait_job() {
  local job=$1 status=unknown
  for _ in $(seq 1 60); do
    curl -fsS -b "$task_dir/cookies" "$origin/api/jobs/$job" > "$task_dir/status.json"
    status=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["status"])' "$task_dir/status.json")
    [ "$status" != failed ] || { cat "$task_dir/status.json"; return 1; }
    if [ "$status" = succeeded ]; then return; fi
    sleep 1
  done
  return 1
}
wait_job "$job"
# Exercise bearer capture through chunk completion and the actual image worker.
curl -fsS -b "$task_dir/cookies" -H 'Content-Type: application/json' \
  -d '{"name":"image-proof-phone"}' "$origin/api/devices" > "$task_dir/device.json"
token=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$task_dir/device.json")
size=$(wc -c < "$task_dir/device.png" | tr -d ' ')
curl -fsS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"filename\":\"device.png\",\"size_bytes\":$size}" "$origin/api/capture/uploads" > "$task_dir/capture.json"
upload=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["id"])' "$task_dir/capture.json")
curl -fsS -X PATCH -H "Authorization: Bearer $token" -H 'Upload-Offset: 0' \
  --data-binary "@$task_dir/device.png" "$origin/api/capture/uploads/$upload" >/dev/null
curl -fsS -X POST -H "Authorization: Bearer $token" \
  "$origin/api/capture/uploads/$upload/complete" > "$task_dir/capture.json"
job=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["job_id"])' "$task_dir/capture.json")
wait_job "$job"
curl -fsS -b "$task_dir/cookies" "$origin/api/assets" > "$task_dir/assets.json"
asset=$(python3 -c 'import json,sys;a=json.load(open(sys.argv[1]))["assets"];assert len(a)==2;print(next(x["id"] for x in a if x["filename"]=="photo.png"))' "$task_dir/assets.json")
curl -fsS -b "$task_dir/cookies" "$origin/api/assets/$asset/original" > "$task_dir/original.png"
cmp "$task_dir/photo.png" "$task_dir/original.png"
curl -fsS -b "$task_dir/cookies" "$origin/api/assets/$asset/thumb" >/dev/null
device_asset=$(python3 -c 'import json,sys;a=json.load(open(sys.argv[1]))["assets"];print(next(x["id"] for x in a if x["filename"]=="device.png"))' "$task_dir/assets.json")
curl -fsS -H "Authorization: Bearer $token" "$origin/api/assets/$device_asset/original" > "$task_dir/device-original.png"
cmp "$task_dir/device.png" "$task_dir/device-original.png"
curl -fsS -b "$task_dir/cookies" "$origin/api/assets/$device_asset/thumb" >/dev/null
docker restart "$server" >/dev/null
origin="http://$(docker port "$server" 39170/tcp | head -1)"
wait_healthy "$origin"
curl -fsS -b "$task_dir/cookies" "$origin/api/assets/$asset/original" > "$task_dir/restarted.png"
cmp "$task_dir/photo.png" "$task_dir/restarted.png"
docker exec "$server" kuraki backup /backups/proof.tar.gz >/dev/null
# Mount the writable PARENT, not the destination that restore atomically replaces.
docker run --rm -v "$backup_volume:/backups:ro" -v "$restore_volume:/restore-root" \
  "$image" restore /backups/proof.tar.gz --data-dir /restore-root/library >/dev/null
docker run --rm -v "$restore_volume:/restore-root" \
  "$image" verify --data-dir /restore-root/library >/dev/null
docker run -d --name "$restored" -p 127.0.0.1::39170 \
  -v "$restore_volume:/restore-root" -e KURAKI_ADDR=:39170 \
  -e KURAKI_DATA_DIR=/restore-root/library "$image" >/dev/null
restored_origin="http://$(docker port "$restored" 39170/tcp | head -1)"
wait_healthy "$restored_origin"
curl -fsS -b "$task_dir/cookies" "$restored_origin/api/assets/$asset/original" > "$task_dir/restored.png"
cmp "$task_dir/photo.png" "$task_dir/restored.png"
curl -fsS -H "Authorization: Bearer $token" "$restored_origin/api/assets/$device_asset/original" > "$task_dir/device-restored.png"
cmp "$task_dir/device.png" "$task_dir/device-restored.png"
curl -fsS -b "$task_dir/cookies" -X DELETE "$restored_origin/api/assets/$asset" >/dev/null
curl -fsS -b "$task_dir/cookies" -X POST "$restored_origin/api/assets/$asset/restore" >/dev/null
curl -fsS -b "$task_dir/cookies" "$restored_origin/api/assets/$asset/original" > "$task_dir/after-trash.png"
cmp "$task_dir/photo.png" "$task_dir/after-trash.png"
printf 'PASS image startup/setup/web+device-upload/thumbnail/restart/backup/restore/verify/trash\n'
