# syntax=docker/dockerfile:1
#
# Kuraki container — the primary "just works" install path. The current image
# builds the default CGO-free binary: ffmpeg provides video posters, while wider
# libvips image-format support remains a separately certified `-tags vips` path.
#
# M1 compiles the SvelteKit UI into internal/httpapi/assets before the Go build
# embeds it. The default binary stays pure-Go.

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
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/httpapi/assets ./internal/httpapi/assets
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath \
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

# Run as an unprivileged user; /data is owned by it so the volume is writable.
RUN useradd --system --uid 10001 --home /data kuraki \
    && mkdir -p /data && chown kuraki:kuraki /data
USER kuraki

VOLUME ["/data"]
ENV KURAKI_DATA_DIR=/data \
    KURAKI_ADDR=:3000
EXPOSE 3000

# Self-probe via the kuraki binary — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["kuraki", "healthcheck"]

ENTRYPOINT ["kuraki"]
CMD ["serve"]
