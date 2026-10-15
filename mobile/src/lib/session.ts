import { clearDeviceToken, type CaptureSettings } from '@/lib/settings';

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

/**
 * reportAuthLost is called by the API layer when a device request returns 401.
 *
 * `failedToken` is the credential the rejected request actually used, and both
 * of the things done with it were bugs before it existed:
 *
 *   - An empty token means the request carried no credential, so there was
 *     nothing to lose. Screens mount and fetch during onboarding, before pairing
 *     has happened; those 401s used to raise "This device was disconnected and
 *     is no longer backing up" at someone who had never paired.
 *   - A non-empty token is only worth clearing while it is still the stored one.
 *     The clear is asynchronous and nothing ordered it against pairing, so a
 *     401 already in flight would delete the token a successful pair had just
 *     written — the server kept an active device, the app said "Not paired".
 */
export function reportAuthLost(failed: string | CaptureSettings): void {
  if (typeof failed === 'string' ? !failed : !failed.deviceToken) return;
  void clearDeviceToken(failed, () => {
    if (lost) return;
    lost = true;
    for (const listener of listeners) listener();
    void import('@/lib/notifications')
      .then(({ notify }) =>
        notify('disconnected', {
          title: 'Kuraki disconnected',
          body: 'This device was disconnected and is no longer backing up. Re-pair it in Settings.',
        }),
      )
      .catch(() => {});
  }).catch(() => {});
}

/** clearAuthLost is called after the user re-pairs successfully. */
export function clearAuthLost(): void {
  if (!lost) return;
  lost = false;
  for (const listener of listeners) listener();
}
