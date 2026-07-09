# syntax=docker/dockerfile:1
#
# Kuraki container — the primary "just works" install path. libvips + ffmpeg are
# baked into the runtime image so the media pipeline (HEIC/AVIF/RAW previews,
# video posters) works out of the box.
#
# M1 compiles the SvelteKit UI into internal/httpapi/assets before the Go build
# embeds it. The default binary stays pure-Go; the libvips backend remains a
# build-tagged follow-up.

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
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips42 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/kuraki /usr/local/bin/kuraki

VOLUME ["/data"]
ENV KURAKI_DATA_DIR=/data \
    KURAKI_ADDR=:3000
EXPOSE 3000

ENTRYPOINT ["kuraki"]
CMD ["serve"]
