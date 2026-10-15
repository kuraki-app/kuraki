import { abortable, throwIfAborted } from '@/lib/cancellation';

// Each verified library owns a distinct DB handle. Serialize push/pull work on
// that handle, never on the credential-write queue and never across libraries.
const tails = new WeakMap<object, Promise<unknown>>();
export function orderedLibraryWork<T>(
  database: object,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const before = tails.get(database) ?? Promise.resolve();
  const next = before
    .catch(() => {})
    .then(() => {
      throwIfAborted(signal);
      return abortable(work(), signal);
    });
  tails.set(database, next);
  const release = () => {
    if (tails.get(database) === next) tails.delete(database);
  };
  void next.then(release, release);
  return abortable(next, signal);
}
