import { File } from 'expo-file-system';

import { reportAuthLost } from '@/lib/session';
import type { CaptureSettings } from '@/lib/settings';

export type CaptureSession = {
  id: string;
  filename: string;
  size_bytes: number;
  received_bytes: number;
  status: string;
  job_id?: string;
  error?: string;
};

export type CaptureStatus = {
  device_id: string;
  receiving: number;
  queued: number;
  failed: number;
  sessions: CaptureSession[];
};

type StartResponse = CaptureSession;

const uploadChunkBytes = 4 << 20;
const chunkRetryLimit = 4;

export class CaptureAPIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'CaptureAPIError';
  }
}

export type PairedDevice = { id: string; name: string; token: string };

/**
 * claimPairing redeems a one-time code shown by the Kuraki web app (typically
 * scanned from a QR). It is unauthenticated — the phone has no credentials yet —
 * and returns the device's own revocable token on success.
 */
export async function claimPairing(baseURL: string, code: string, name: string): Promise<PairedDevice> {
  const origin = baseURL.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${origin}/api/devices/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
  } catch {
    // A transport failure here is almost always the address, not the code: the
    // phone is on another network, or the QR carried an address only the
    // server's own machine can resolve. `fetch` reports it as a bare
    // "Network request failed", which names nothing the owner can act on.
    throw new CaptureAPIError(
      `Could not reach ${origin}. Check the phone is on the same network as your server, and that the address in the code is the server's network address.`,
      0,
      true,
    );
  }
  return unwrap<PairedDevice>(response, 'Pairing failed. Generate a new code and try again.');
}

export async function getCaptureStatus(settings: CaptureSettings): Promise<CaptureStatus> {
  requireConnected(settings);
  const response = await fetch(`${settings.baseURL}/api/capture/status`, {
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  });
  return unwrap<CaptureStatus>(response, 'Could not check backup status.');
}

/**
 * uploadFile streams a single file to the resumable capture API. Each chunk is
 * retried with backoff so a brief network drop resumes from the server's
 * acknowledged offset rather than failing the whole upload. It is the shared
 * primitive behind both the manual picker and the automatic backup engine.
 */
export async function uploadFile(
  settings: CaptureSettings,
  file: { uri: string; filename: string; takenAt?: string },
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
  resume?: ResumeHooks,
): Promise<CaptureSession> {
  requireConnected(settings);
  const source = await openSource(file.uri);
  try {
    if (source.size < 1) throw new CaptureAPIError('The selected item is empty.', 0);

    let session = await startOrResume(settings, file.filename, source.size, resume, file.takenAt);
    let offset = session.offset;

    while (offset < source.size) {
      throwIfAborted(signal);
      const length = Math.min(uploadChunkBytes, source.size - offset);
      const body = await source.readChunk(offset, length);
      try {
        offset = await sendChunk(settings, session.id, body, offset, source.size, signal);
      } catch (cause) {
        // A resumed session the server no longer has (expired by the janitor,
        // or purged with the device) is not a real upload failure -- start a
        // fresh one once rather than surfacing it to the user.
        if (session.resumed && isMissingSession(cause)) {
          await resume?.clear();
          session = await startOrResume(settings, file.filename, source.size, undefined, file.takenAt);
          offset = session.offset;
          continue;
        }
        throw cause;
      }
      // Persist progress so a process death resumes here, not at byte 0.
      await resume?.save({ sessionId: session.id, sizeBytes: source.size, offsetBytes: offset });
      onProgress?.(offset, source.size);
    }
    const done = await deviceRequest<CaptureSession>(settings, `/api/capture/uploads/${session.id}/complete`, {
      method: 'POST',
    });
    await resume?.clear();
    return done;
  } finally {
    source.close();
  }
}

/**
 * ResumeHooks lets a caller persist an in-flight session so an interrupted
 * upload continues across process death. Without it uploadFile behaves exactly
 * as before -- one session per call, starting at zero.
 */
export type ResumeHooks = {
  load: () => Promise<{ sessionId: string; sizeBytes: number; offsetBytes: number } | null>;
  save: (upload: { sessionId: string; sizeBytes: number; offsetBytes: number }) => Promise<void>;
  clear: () => Promise<void>;
};

/**
 * startOrResume reuses a stored session when one still describes this file,
 * otherwise opens a new one. A stored offset is only ever a hint: the first
 * PATCH carries it, and the server's 409 + Upload-Offset realignment (see
 * sendChunk) corrects any drift, so a stale hint costs one round trip rather
 * than corrupting the upload.
 */
async function startOrResume(
  settings: CaptureSettings,
  filename: string,
  size: number,
  resume?: ResumeHooks,
  takenAt?: string,
): Promise<{ id: string; offset: number; resumed: boolean }> {
  const stored = resume ? await resume.load() : null;
  if (stored && stored.sizeBytes === size && stored.offsetBytes > 0 && stored.offsetBytes < size) {
    return { id: stored.sessionId, offset: stored.offsetBytes, resumed: true };
  }
  const start = await deviceRequest<StartResponse>(settings, '/api/capture/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // taken_at is the phone's own record of when the item was captured. The
    // server treats it as a fallback below EXIF, and it is what stops a
    // screenshot -- which carries no EXIF at all -- importing with no date and
    // grouping under "Undated".
    body: JSON.stringify({ filename, size_bytes: size, ...(takenAt ? { taken_at: takenAt } : {}) }),
  });
  return { id: start.id, offset: start.received_bytes, resumed: false };
}

function isMissingSession(cause: unknown): boolean {
  return cause instanceof CaptureAPIError && (cause.status === 404 || cause.status === 410);
}

// MediaSource reads a file one chunk at a time so a multi-gigabyte video is
// never fully materialised in memory. On-disk files stream through a native
// FileHandle; anything else (a content:// or remote URI) falls back to a single
// buffered read.
type MediaSource = {
  size: number;
  readChunk: (offset: number, length: number) => Promise<ArrayBuffer>;
  close: () => void;
};

async function openSource(uri: string): Promise<MediaSource> {
  if (uri.startsWith('file://')) {
    const file = new File(uri);
    const size = file.size ?? 0;
    const handle = file.open();
    return {
      size,
      readChunk: (offset, length) => {
        handle.offset = offset;
        const bytes = handle.readBytes(length);
        return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      },
      close: () => handle.close(),
    };
  }
  const response = await fetch(uri);
  if (!response.ok) throw new CaptureAPIError('Could not read the selected item.', response.status);
  const blob = await response.blob();
  return {
    size: blob.size,
    readChunk: (offset, length) => blob.slice(offset, offset + length).arrayBuffer(),
    close: () => {},
  };
}

/** uploadPhoto keeps the manual-picker call site unchanged. */
export async function uploadPhoto(
  settings: CaptureSettings,
  asset: { uri: string; filename: string },
  onProgress: (completed: number, total: number) => void,
): Promise<CaptureSession> {
  return uploadFile(settings, asset, onProgress);
}

async function sendChunk(
  settings: CaptureSettings,
  sessionID: string,
  body: ArrayBuffer,
  offset: number,
  total: number,
  signal?: AbortSignal,
): Promise<number> {
  let attempt = 0;
  for (;;) {
    throwIfAborted(signal);
    try {
      const response = await fetch(`${settings.baseURL}/api/capture/uploads/${sessionID}`, {
        method: 'PATCH',
        signal,
        headers: {
          Authorization: `Bearer ${settings.deviceToken}`,
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
        },
        body,
      });
      if (response.ok) {
        const next = Number(response.headers.get('Upload-Offset'));
        if (!Number.isFinite(next) || next <= offset || next > total) {
          throw new CaptureAPIError('Server returned an invalid upload receipt.', response.status);
        }
        return next;
      }
      if (response.status === 401) {
        reportAuthLost();
        throw new CaptureAPIError('This device was disconnected. Re-pair it in Settings.', 401);
      }
      // A 409 with an Upload-Offset header means the server already advanced past
      // this chunk; realign to its offset and let the caller continue.
      const serverOffset = Number(response.headers.get('Upload-Offset'));
      if (response.status === 409 && Number.isFinite(serverOffset) && serverOffset >= offset && serverOffset <= total) {
        return serverOffset;
      }
      const failure = await response.json().catch(() => ({}));
      const message = typeof failure.error === 'string' ? failure.error : `Upload failed (${response.status})`;
      throw new CaptureAPIError(message, response.status, response.status >= 500);
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      const retryable = cause instanceof CaptureAPIError ? cause.retryable : true;
      if (!retryable || attempt >= chunkRetryLimit) {
        if (cause instanceof CaptureAPIError) throw cause;
        throw new CaptureAPIError('Network error during upload.', 0, true);
      }
      await backoff(attempt++, signal);
    }
  }
}

async function deviceRequest<T>(settings: CaptureSettings, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${settings.baseURL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${settings.deviceToken}`, ...init.headers },
  });
  return unwrap<T>(response, `Request failed (${response.status})`);
}

async function unwrap<T>(response: Response, fallback: string): Promise<T> {
  if (response.status === 401) {
    reportAuthLost();
    throw new CaptureAPIError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === 'string' ? body.error : fallback;
    throw new CaptureAPIError(message, response.status, response.status >= 500);
  }
  return (await response.json()) as T;
}

function requireConnected(settings: CaptureSettings): void {
  if (!settings.baseURL || !settings.deviceToken) {
    throw new CaptureAPIError('Connect this device in Settings first.', 0);
  }
}

function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 8000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}
