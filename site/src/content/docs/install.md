---
title: Install
description: Get Kuraki running on your own server in about a minute, with Docker or a single binary.
order: 10
---

## Docker

The image bundles libvips, ffmpeg and tesseract, so HEIC images, video posters and optional OCR all
work without further setup.

```sh
docker run -d -p 3000:3000 -v "$PWD/kuraki-data:/data" ghcr.io/kuraki-app/kuraki:latest
```

Open `http://localhost:3000` and create the owner account. That first form is the whole setup: there
is no configuration file to write and no external service to sign up for.

The container runs **one process** — `kuraki serve` on port 3000 — which serves the API, the media,
`/healthz`, `/metrics` and the web UI from a single origin. Any argument that is not `serve` is
passed straight through to the CLI, which is why this works:

```sh
docker compose exec kuraki kuraki import /data/incoming
```

## A single binary

Pure-Go builds, no runtime dependencies, nothing to install. Download the one for your platform from
the [releases page](https://github.com/kuraki-app/kuraki/releases/latest) and run it:

```sh
./kuraki serve
```

Image format support is deliberately narrower here than in the Docker image, because libvips is not
linked into the default build. Anything Kuraki cannot preview still imports and stays downloadable —
see the [media support matrix](https://github.com/kuraki-app/kuraki/blob/main/MEDIA_SUPPORT.md).

## Exposing it to the internet

Do not put the container straight onto a public port. Front it with the HTTPS reverse proxy in
[`deploy/`](https://github.com/kuraki-app/kuraki/tree/main/deploy) and turn on two settings that
matter once you do:

- `KURAKI_SECURE_COOKIES=1` marks the session cookie `Secure`.
- `KURAKI_TRUST_PROXY=1` makes Kuraki read the client IP from `X-Forwarded-For`.

Enable `KURAKI_TRUST_PROXY` **only** behind a proxy you control. Trusting that header when nothing
sets it lets anyone spoof their address, which quietly weakens the login rate limit.

Full detail: [DEPLOYMENT.md](https://github.com/kuraki-app/kuraki/blob/main/DEPLOYMENT.md).
