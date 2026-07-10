import { clearDeviceToken } from '@/lib/settings';

// A tiny process-wide signal for "the server rejected our device token" (401).
// Any device request that sees a 401 reports it here; screens subscribe and show
// a reconnect prompt instead of raw errors, and the stale token is cleared so
// Settings reflects the disconnected state.

type Listener = () => void;

const listeners = new Set<Listener>();
let lost = false;

export function isAuthLost(): boolean {
  return lost;
}

export function onAuthLost(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** reportAuthLost is called by the API layer when a device request returns 401. */
export function reportAuthLost(): void {
  if (lost) return;
  lost = true;
  void clearDeviceToken();
  for (const listener of listeners) listener();
}

/** clearAuthLost is called after the user re-pairs successfully. */
export function clearAuthLost(): void {
  lost = false;
}
