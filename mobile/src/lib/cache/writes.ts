import { throwIfAborted } from '@/lib/cancellation';

// Native SQLite transactions span async awaits on a shared connection. Keep
// every cache write on this lane so an unrelated mutation cannot join a mirror
// transaction and disappear in its rollback. Never release on cancellation:
// the native transaction must actually finish before another write is safe.
// Credential recovery and other libraries use separate lanes.
const tails = new WeakMap<object, Promise<unknown>>();
export function writeLibraryCache<T>(
  database: object,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const before = tails.get(database) ?? Promise.resolve();
  const next = before.catch(() => {}).then(async () => {
    throwIfAborted(signal); // Skip canceled work that never reached native I/O.
    const result = await work(); // Native transactions own the lane to completion.
    throwIfAborted(signal);
    return result;
  });
  tails.set(database, next);
  const release = () => {
    if (tails.get(database) === next) tails.delete(database);
  };
  void next.then(release, release);
  return next;
}
