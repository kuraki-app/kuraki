#!/usr/bin/env python3
"""Validate the resolved production Compose model and service-user mounts."""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def validate(model):
    services = model.get("services", {})
    app = services.get("kuraki", {})
    env = app.get("environment", {})
    if app.get("ports"):
        raise ValueError("Production Kuraki must be reachable only through its HTTPS proxy.")
    if str(env.get("KURAKI_SECURE_COOKIES")) != "1" or str(env.get("KURAKI_TRUST_PROXY")) != "1":
        raise ValueError("The private proxy deployment requires secure cookies and trusted forwarding.")
    url = urlparse(env.get("KURAKI_PUBLIC_URL", ""))
    if url.scheme != "https" or not url.hostname or url.hostname == "photos.example.com" or url.username or url.password:
        raise ValueError("Set KURAKI_PUBLIC_URL to your actual HTTPS origin and match it in Caddyfile.")
    if env.get("KURAKI_DATA_DIR", "/data") != "/data" or env.get("KURAKI_BACKUP_DIR") != "/backups":
        raise ValueError("Set KURAKI_DATA_DIR=/data and KURAKI_BACKUP_DIR=/backups to use the durable mounts.")
    mounts = {item["target"]: item for item in app.get("volumes", [])}
    selected = []
    for name, target in (("library", "/data"), ("backup", "/backups")):
        mount = mounts.get(target)
        if not mount or mount.get("read_only"):
            raise ValueError(f"A writable {name} mount at {target} is required.")
        source = mount.get("source", "")
        if mount.get("type") == "bind" and not Path(source).is_dir():
            raise ValueError(f"Create and provision the {name} directory before starting: {source}")
        selected.append((source, target))
    data, backups = (os.path.realpath(item[0]) for item in selected)
    if data == backups or os.path.commonpath((data, backups)) in (data, backups):
        raise ValueError("The backup source must be separate from the library directory.")
    if not services.get("caddy", {}).get("ports"):
        raise ValueError("The HTTPS proxy has no published ports.")
    return app["image"], selected


def main():
    compose = sys.argv[1] if len(sys.argv) > 1 else "deploy/docker-compose.caddy.yml"
    config = subprocess.check_output(["docker", "compose", "-f", compose, "config", "--format", "json"])
    image, mounts = validate(json.loads(config))
    command = ["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "sh"]
    for source, target in mounts:
        command.extend(["-v", f"{source}:{target}"])
    command.extend([image, "-c", "test -r /data && test -w /data && test -x /data && test -w /backups && test -x /backups"])
    subprocess.run(command, check=True)
    print("PASS private HTTPS configuration and service-user mount access")
    print("Confirm DNS/certificate renewal and a separate physical backup disk on the target host.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"Deployment check failed: {error}", file=sys.stderr)
        sys.exit(1)
