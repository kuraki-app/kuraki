import { openSource } from '@/lib/media-source';
import {
  jsonRequest,
  request,
  RequestError,
  throwIfAborted,
  isAbort,
  abortError,
} from '@/lib/request';
import { canResume, validProof, type OriginalProof } from '@/lib/backup-ledger';

import { reportAuthLost } from '@/lib/session';
import { StaleConnectionError, type CaptureSettings } from '@/lib/settings';

export type CaptureSession = {
  id: string;
  filename: string;
  size_bytes: number;
  received_bytes: number;
  status: string;
  job_id?: string;
  error?: string;
  proof?: OriginalProof;
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
export async function claimPairing(
  baseURL: string,
  code: string,
  name: string,
  signal?: AbortSignal,
): Promise<PairedDevice> {
  const origin = baseURL.replace(/\/+$/, '');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${origin}/api/devices/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
      signal: controller.signal,
    });
    const device = await unwrap<PairedDevice>(
      response,
      'Pairing failed. Generate a new code and try again.',
    );
    throwIfAborted(controller.signal);
    return device;
  } catch (cause) {
    if (signal?.aborted || cause instanceof CaptureAPIError) throw cause;
    throw new CaptureAPIError(
      `Could not reach ${origin}. Check your network and server address, then try again.`,
      0,
      true,
    );
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getCaptureStatus(
  settings: CaptureSettings,
  signal?: AbortSignal,
): Promise<CaptureStatus> {
  return jsonRequest(settings, '/api/capture/status', {}, signal);
}

export async function verifyOriginal(
  settings: CaptureSettings,
  proof: OriginalProof,
  signal?: AbortSignal,
): Promise<void> {
  if (!validProof(proof)) throw new Error('A verified original is required.');
  const result = await jsonRequest<{ status: string; proof?: OriginalProof }>(
    settings,
    '/api/capture/originals/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proof),
    },
    signal,
    60_000,
  );
  if (
    result.status !== 'verified' ||
    !validProof(result.proof) ||
    result.proof.asset_id !== proof.asset_id ||
    result.proof.content_hash !== proof.content_hash ||
    result.proof.size_bytes !== proof.size_bytes
  )
    throw new Error('The server could not verify this original.');
}

export async function availableOriginals(
  settings: CaptureSettings,
  originals: OriginalProof[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (!originals.length) return new Set();
  const result = await jsonRequest<{ available: string[] }>(
    settings,
    '/api/capture/originals/available',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originals }),
    },
    signal,
  );
  if (
    !Array.isArray(result.available) ||
    result.available.some((id) => typeof id !== 'string')
  )
    throw new Error('Invalid original availability response.');
  return new Set(result.available);
}

async function originalReceipt(
  settings: CaptureSettings,
  id: string,
  size: number,
  signal?: AbortSignal,
  polls = 4,
): Promise<OriginalProof> {
  for (let attempt = 0; attempt < polls; attempt++) {
    const result = await jsonRequest<{ status: string; proof?: OriginalProof }>(
      settings,
      `/api/capture/uploads/${id}/receipt`,
      {},
      signal,
    );
    if (
      result.status === 'completed' &&
      validProof(result.proof) &&
      result.proof.size_bytes === size
    )
      return result.proof;
    if (result.status !== 'pending')
      throw new Error('The server returned an invalid original receipt.');
    if (attempt + 1 < polls) await backoff(attempt, signal, 250);
  }
  throw new RequestError(
    'Waiting for the server to finish importing this original.',
    202,
    true,
  );
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
  options: { requireReceipt?: boolean; beforeChunk?: () => Promise<void> } = {},
): Promise<CaptureSession> {
  requireConnected(settings);
  const source = await openSource(file.uri, signal);
  try {
    if (source.size < 1)
      throw new CaptureAPIError('The selected item is empty.', 0);

    let session = await startOrResume(
      settings,
      file.filename,
      source.size,
      resume,
      file.takenAt,
      signal,
    );
    let restarts = 0;
    let corrections = 0;
    for (;;) {
      try {
        let offset = session.offset;
        // A completed-byte session may already belong to a successful import,
        // even after rotating the device token. Resolve its owner receipt first.
        if (
          session.resumed &&
          offset === source.size &&
          options.requireReceipt
        ) {
          try {
            const proof = await originalReceipt(
              settings,
              session.id,
              source.size,
              signal,
              1,
            );
            await resume?.clear();
            return {
              id: session.id,
              filename: file.filename,
              size_bytes: source.size,
              received_bytes: source.size,
              status: 'completed',
              proof,
            };
          } catch (cause) {
            // The process may have died after persisting the last chunk but
            // before completion. Pending still needs the idempotent handoff.
            if (!(cause instanceof RequestError && cause.status === 202))
              throw cause;
          }
        }
        while (offset < source.size) {
          throwIfAborted(signal);
          await options.beforeChunk?.();
          const length = Math.min(uploadChunkBytes, source.size - offset);
          const body = await source.readChunk(offset, length);
          const next = await sendChunk(
            settings,
            session.id,
            body,
            offset,
            source.size,
            signal,
          );
          if (next < offset && ++corrections > 2)
            throw new CaptureAPIError(
              'Upload offsets did not converge. Retry this item.',
              409,
            );
          offset = next;
          await resume?.save({
            sessionId: session.id,
            sizeBytes: source.size,
            offsetBytes: offset,
          });
          onProgress?.(offset, source.size);
        }
        throwIfAborted(signal);
        await options.beforeChunk?.();
        const done = await deviceRequest<CaptureSession>(
          settings,
          `/api/capture/uploads/${session.id}/complete`,
          { method: 'POST' },
          signal,
        );
        if (options.requireReceipt)
          done.proof = await originalReceipt(
            settings,
            session.id,
            source.size,
            signal,
          );
        await resume?.clear();
        return done;
      } catch (cause) {
        if (!isMissingSession(cause)) throw cause;
        await resume?.clear();
        if (restarts++ >= 1) throw cause;
        session = await startOrResume(
          settings,
          file.filename,
          source.size,
          resume,
          file.takenAt,
          signal,
        );
      }
    }
  } finally {
    await source.close();
  }
}

/**
 * ResumeHooks lets a caller persist an in-flight session so an interrupted
 * upload continues across process death. Without it uploadFile behaves exactly
 * as before -- one session per call, starting at zero.
 */
export type ResumeHooks = {
  load: () => Promise<{
    sessionId: string;
    sizeBytes: number;
    offsetBytes: number;
  } | null>;
  save: (upload: {
    sessionId: string;
    sizeBytes: number;
    offsetBytes: number;
  }) => Promise<void>;
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
  signal?: AbortSignal,
): Promise<{ id: string; offset: number; resumed: boolean }> {
  const stored = resume ? await resume.load() : null;
  if (canResume(stored, size)) {
    return {
      id: stored!.sessionId,
      offset: stored!.offsetBytes,
      resumed: true,
    };
  }
  const start = await deviceRequest<StartResponse>(
    settings,
    '/api/capture/uploads',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // taken_at is the phone's own record of when the item was captured. The
      // server treats it as a fallback below EXIF, and it is what stops a
      // screenshot -- which carries no EXIF at all -- importing with no date and
      // grouping under "Undated".
      body: JSON.stringify({
        filename,
        size_bytes: size,
        ...(takenAt ? { taken_at: takenAt } : {}),
      }),
    },
    signal,
  );
  if (
    !Number.isSafeInteger(start.received_bytes) ||
    start.received_bytes < 0 ||
    start.received_bytes > size ||
    !start.id
  )
    throw new Error('Server returned an invalid upload session.');
  await resume?.save({
    sessionId: start.id,
    sizeBytes: size,
    offsetBytes: start.received_bytes,
  });
  return { id: start.id, offset: start.received_bytes, resumed: false };
}

function isMissingSession(cause: unknown): boolean {
  return (
    (cause instanceof CaptureAPIError || cause instanceof RequestError) &&
    (cause.status === 404 || cause.status === 410)
  );
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
      const response = await request(
        settings,
        `/api/capture/uploads/${sessionID}`,
        {
          method: 'PATCH',
          signal,
          headers: {
            Authorization: `Bearer ${settings.deviceToken}`,
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': String(offset),
          },
          body,
        },
        async (response) => ({
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          failure:
            response.ok || response.status === 401
              ? {}
              : await response.json().catch(() => ({})),
        }),
        signal,
        120_000,
      );
      if (response.ok) {
        const next = Number(response.headers.get('Upload-Offset'));
        if (
          !Number.isSafeInteger(next) ||
          next <= offset ||
          next > total ||
          next !== offset + body.byteLength
        ) {
          throw new CaptureAPIError(
            'Server returned an invalid upload receipt.',
            response.status,
          );
        }
        return next;
      }
      if (response.status === 401) {
        reportAuthLost(settings);
        throw new CaptureAPIError(
          'This device was disconnected. Re-pair it in Settings.',
          401,
        );
      }
      // A 409 with an Upload-Offset header means the server already advanced past
      // this chunk; realign to its offset and let the caller continue.
      const rawOffset = response.headers.get('Upload-Offset');
      const serverOffset =
        rawOffset !== null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN;
      if (
        response.status === 409 &&
        Number.isSafeInteger(serverOffset) &&
        serverOffset !== offset &&
        serverOffset >= 0 &&
        serverOffset <= total
      ) {
        return serverOffset;
      }
      const failure = response.failure;
      const message =
        typeof failure.error === 'string'
          ? failure.error
          : `Upload failed (${response.status})`;
      throw new CaptureAPIError(
        message,
        response.status,
        response.status >= 500,
      );
    } catch (cause) {
      if (isAbort(cause) || cause instanceof StaleConnectionError) throw cause;
      const retryable =
        cause instanceof CaptureAPIError || cause instanceof RequestError
          ? cause.retryable
          : true;
      if (!retryable || attempt >= chunkRetryLimit) {
        if (cause instanceof CaptureAPIError) throw cause;
        throw new CaptureAPIError('Network error during upload.', 0, true);
      }
      await backoff(attempt++, signal);
    }
  }
}

async function deviceRequest<T>(
  settings: CaptureSettings,
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await jsonRequest<T>(settings, path, init, signal);
  } catch (error) {
    if (error instanceof RequestError)
      throw new CaptureAPIError(error.message, error.status, error.retryable);
    throw error;
  }
}

// `token` is the credential the request carried, so a 401 can be attributed to
// it rather than to whatever happens to be stored by the time it is handled.
async function unwrap<T>(
  response: Response,
  fallback: string,
  token = '',
): Promise<T> {
  if (response.status === 401) {
    reportAuthLost(token);
    throw new CaptureAPIError(
      'This device was disconnected. Re-pair it in Settings.',
      401,
    );
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

function backoff(
  attempt: number,
  signal?: AbortSignal,
  base = 1000,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      reject(abortError());
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', aborted);
        resolve();
      },
      Math.min(base * 2 ** attempt, 8000),
    );
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
