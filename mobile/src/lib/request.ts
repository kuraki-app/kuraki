import { reportAuthLost } from '@/lib/session';
import {
  assertActiveConnection,
  onCaptureSettingsChange,
  type CaptureSettings,
} from '@/lib/settings';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}
export function abortError(): Error {
  const error = new Error('Cancelled');
  error.name = 'AbortError';
  return error;
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Keeps cancellation and identity ownership through body decoding as well as headers. */
export async function request<T>(
  settings: CaptureSettings,
  path: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  throwIfAborted(signal);
  await assertActiveConnection(settings);
  throwIfAborted(signal);
  if (!settings.baseURL || !settings.deviceToken)
    throw new RequestError('Connect this device in Settings first.', 0);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const unsubscribe = onCaptureSettingsChange(abort);
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${settings.baseURL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${settings.deviceToken}`,
        ...(settings.ownerID ? { 'X-Kuraki-Owner-ID': settings.ownerID } : {}),
        ...init.headers,
      },
    });
    await assertActiveConnection(settings);
    throwIfAborted(controller.signal);
    const result = await read(response);
    await assertActiveConnection(settings);
    throwIfAborted(controller.signal);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    unsubscribe();
  }
}
export async function jsonRequest<T>(
  settings: CaptureSettings,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  return request(
    settings,
    path,
    init,
    async (response) => {
      if (response.status === 401) {
        reportAuthLost(settings);
        throw new RequestError(
          'This device was disconnected. Re-pair it in Settings.',
          401,
        );
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new RequestError(
          typeof body.error === 'string'
            ? body.error
            : `Request failed (${response.status})`,
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }
      return (await response.json()) as T;
    },
    signal,
    timeoutMs,
  );
}

// Native Photos/provider operations cannot always be cancelled internally.
// Release this pass immediately, and refuse/clean up any later result.
export function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    void operation.catch(() => {});
    return Promise.reject(abortError());
  }
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
