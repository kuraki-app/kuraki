import { File } from 'expo-file-system';

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
  const url = `${baseURL.replace(/\/+$/, '')}/api/devices/pair/claim`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
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
  file: { uri: string; filename: string },
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CaptureSession> {
  requireConnected(settings);
  const source = await openSource(file.uri);
  try {
    if (source.size < 1) throw new CaptureAPIError('The selected item is empty.', 0);

    const start = await deviceRequest<StartResponse>(settings, '/api/capture/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.filename, size_bytes: source.size }),
    });

    let offset = start.received_bytes;
    while (offset < source.size) {
      throwIfAborted(signal);
      const length = Math.min(uploadChunkBytes, source.size - offset);
      const body = await source.readChunk(offset, length);
      offset = await sendChunk(settings, start.id, body, offset, source.size, signal);
      onProgress?.(offset, source.size);
    }
    return deviceRequest<CaptureSession>(settings, `/api/capture/uploads/${start.id}/complete`, { method: 'POST' });
  } finally {
    source.close();
  }
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
