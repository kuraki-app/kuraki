# syntax=docker/dockerfile:1
#
# Kuraki container — the primary "just works" install path. libvips + ffmpeg are
# baked into the runtime image so the media pipeline (HEIC/AVIF/RAW previews,
# video posters) works out of the box.
#
# M0 builds the pure-Go binary (CGO off). M1 flips the build to `-tags vips`
# with CGO + libvips-dev in the build stage to link the libvips backend, and
# adds a Node stage that compiles the SvelteKit UI into internal/httpapi/assets
# before the Go build embeds it.

# --- build stage ---
FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
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
