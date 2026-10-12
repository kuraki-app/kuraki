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
