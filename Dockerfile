# syntax=docker/dockerfile:1
#
# Kuraki container — the primary "just works" install path.
#
# This image is the `-tags vips` profile: the build stage below compiles with
# CGO_ENABLED=1 against libvips-dev, so the container decodes the wider image
# formats (HEIC/AVIF/TIFF and friends) that the pure-Go fallback cannot, and
# ffmpeg provides video posters and playback derivatives.
#
# That is a deliberate difference from every other build. `go build ./...` with
# no tags stays pure-Go and CGO-free (invariant 5 in CLAUDE.md); only this image
# and the `media-vips` CI job exercise the tagged path.
#
# The web stage compiles the SvelteKit UI into internal/httpapi/assets before the
# Go build embeds it.
#
# The runtime image runs ONE process — `kuraki serve` on :3000 — which serves
# the API, media, AND the embedded SvelteKit UI (including first-run setup) from
# a single origin. See scripts/docker-entrypoint.sh. For internet exposure with
# automatic HTTPS, front this with the reverse proxy in deploy/ (DEPLOYMENT.md).

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

# libvips42 is the runtime half of the `-tags vips` build above — the binary is
# dynamically linked against it and will not start without it. ffmpeg powers
# video posters and playback derivatives; tesseract (with the English model)
# enables the opt-in local OCR worker when KURAKI_OCR=1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips42 ffmpeg tesseract-ocr tesseract-ocr-eng ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/kuraki /usr/local/bin/kuraki
COPY --chmod=0755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Ship the prebuilt Android app served at /download/android. The APK is a 51MB
# out-of-band artifact (gitignored, not source), so copy the whole directory:
# the .apk rides along in release builds where an operator has placed it here,
# and is simply absent in CI / from-source builds (the endpoint then 404s).
# KURAKI_ANDROID_APK below points the download endpoint at it.
COPY web/assets/download/ /opt/kuraki/

# Run as an unprivileged user; /data is owned by it so the volume is writable.
RUN useradd --system --uid 10001 --home /data kuraki \
    && mkdir -p /data && chown kuraki:kuraki /data
USER kuraki

VOLUME ["/data"]
ENV KURAKI_DATA_DIR=/data \
    KURAKI_ADDR=:3000 \
    KURAKI_ANDROID_APK=/opt/kuraki/kuraki-android.apk
# 3000 = Go server: API + media + embedded UI (single origin).
EXPOSE 3000

# Self-probe the API via the kuraki binary — no curl/wget needed in the image.
# If the API is down the UI is useless too, so probing :3000 covers both.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["kuraki", "healthcheck"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
