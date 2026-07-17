# syntax=docker/dockerfile:1
#
# Kuraki container — the primary "just works" install path. The current image
# builds the default CGO-free binary: ffmpeg provides video posters, while wider
# libvips image-format support remains a separately certified `-tags vips` path.
#
# M1 compiles the SvelteKit UI into internal/httpapi/assets before the Go build
# embeds it. The default binary stays pure-Go.
#
# The runtime image runs BOTH surfaces in one container: the Go server on :3000
# (API + media, and the embedded UI as a fallback) and a Caddy static server on
# :8080 that serves the SvelteKit UI as its own origin, proxying /api, /healthz,
# and /metrics back to :3000. See scripts/docker-entrypoint.sh + deploy/ui.Caddyfile.

# --- web build stage ---
FROM node:24-bookworm-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
COPY internal/httpapi/assets ./internal/httpapi/assets
RUN cd web && npm run build

# --- Go build stage ---
FROM golang:1.26-bookworm AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/httpapi/assets ./internal/httpapi/assets
ARG VERSION=dev
RUN CGO_ENABLED=1 go build -trimpath -tags vips \
      -ldflags "-s -w -X main.version=${VERSION}" \
      -o /out/kuraki ./cmd/kuraki

# --- runtime stage ---
FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="Kuraki" \
      org.opencontainers.image.description="Lightweight self-hosted photo backup & sync" \
      org.opencontainers.image.source="https://github.com/kuraki-app/kuraki" \
      org.opencontainers.image.licenses="AGPL-3.0"

# ffmpeg powers video posters; tesseract (with the English model) enables the
# opt-in local OCR worker when KURAKI_OCR=1. libvips is installed for the future
# tagged image profile but is not linked by this default binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips42 ffmpeg tesseract-ocr tesseract-ocr-eng ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/kuraki /usr/local/bin/kuraki

# Caddy serves the SvelteKit UI on :8080 as its own origin. Pull the static
# binary from the official image (no apt), the built SPA from the web stage, and
# the in-container UI config. See deploy/ui.Caddyfile + scripts/docker-entrypoint.sh.
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
COPY --from=web /src/internal/httpapi/assets /srv/web
COPY deploy/ui.Caddyfile /etc/caddy/Caddyfile
COPY --chmod=0755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Ship the prebuilt Android app served at /download/android. It lives outside
# /data (a runtime volume that would shadow it) and is not embedded in the Go
# binary. KURAKI_ANDROID_APK below points the download endpoint at it.
COPY web/assets/download/kuraki-android.apk /opt/kuraki/kuraki-android.apk

# Run as an unprivileged user; /data is owned by it so the volume is writable.
RUN useradd --system --uid 10001 --home /data kuraki \
    && mkdir -p /data && chown kuraki:kuraki /data
USER kuraki

VOLUME ["/data"]
# Keep Caddy's scratch state off the /data volume (admin/persist are disabled,
# so this stays tiny) and out of the read-only home.
ENV KURAKI_DATA_DIR=/data \
    KURAKI_ADDR=:3000 \
    XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp \
    KURAKI_ANDROID_APK=/opt/kuraki/kuraki-android.apk
# 3000 = Go API + media (canonical origin) · 8080 = SvelteKit UI (proxies /api).
EXPOSE 3000 8080

# Self-probe the API via the kuraki binary — no curl/wget needed in the image.
# If the API is down the UI is useless too, so probing :3000 covers both.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["kuraki", "healthcheck"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
