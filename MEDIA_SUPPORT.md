# Media support matrix

Kuraki separates **admission** (will retain the original), **metadata**,
**derivatives**, and **browser rendering**. Importing an original is never a
promise that a browser can display it directly. Unsupported playback and preview
remain downloadable and appear in Media health.

| Family | Original admission | Native pure-Go derivative | Docker/libvips derivative | Browser presentation | Release evidence required |
| --- | --- | --- | --- | --- | --- |
| JPEG, PNG, GIF, WebP | Content-signature verified | Thumbnail | Thumbnail | Original when browser-safe | Unit fixtures + HTTP MIME/range |
| AVIF, HEIC/HEIF, TIFF | Content-signature verified | Download-only if undecodable | Preview thumbnail when libvips decodes | Derived preview, never original by assumption | Docker fixture + Chromium/Firefox/WebKit check |
| Camera RAW | Extension exception pending fixture decoder policy | Download-only | Best-effort libvips preview | Derived preview only | Per-format fixture and browser check |
| MP4/M4V/MOV/WebM | Content-signature verified | Poster through ffmpeg | Poster through ffmpeg | Original only when codec-safe; otherwise H.264/AAC derivative | ffprobe fixture + three-browser playback |
| Other opaque video | Content-signature verified where recognized | Download-only or ffmpeg derivative | Download-only or ffmpeg derivative | Derived playback only when generated | Fixture plus browser playback |

## Certification policy

1. A row is advertised as supported only after a licensed fixture proves the
   stated admission, metadata, derivative, HTTP, and browser behavior.
2. Pure-Go and Docker/libvips profiles are separately tested. The Docker image
   deliberately builds the `vips` tagged processor; native builds remain
   CGO-free.
3. Certification fixtures must include original download and failure behavior,
   not only successful preview cases.
