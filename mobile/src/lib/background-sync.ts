import { flushMutationsQueue, syncChanges } from '@/lib/library-api';
import { loadCaptureSettings } from '@/lib/settings';

export type BackgroundSyncResult = {
  ran: boolean;
  applied: number;
  reset: boolean;
  /** Set when the pass was skipped or failed; null on a clean run. */
  reason: string | null;
};

/**
 * drainBackgroundSync pulls server-side changes and pushes queued offline
 * mutations, without any UI attached.
 *
 * Both halves previously ran only from the Library screen -- on mount and on
 * AppState 'active' -- so a user parked on the Backup or Settings tab never
 * saw edits made on the web UI, and a favourite queued while offline sat in
 * `pending_mutations` until they happened to trigger a reconnect. Neither had
 * any background trigger at all, despite the app advertising background sync.
 *
 * Failures are swallowed into `reason` rather than thrown: a background wake
 * that cannot reach the server is an ordinary condition, not a task failure,
 * and reporting Failed to the OS invites it to back off scheduling us.
 */
export async function drainBackgroundSync(): Promise<BackgroundSyncResult> {
  const idle: BackgroundSyncResult = { ran: false, applied: 0, reset: false, reason: null };

  let settings;
  try {
    settings = await loadCaptureSettings();
  } catch (cause) {
    return { ...idle, reason: describe(cause, 'Could not read this device’s settings.') };
  }
  if (!settings.baseURL || !settings.deviceToken) {
    return { ...idle, reason: 'This device is not connected to a server.' };
  }

  // Push before pull. A queued favourite or trash applied locally should reach
  // the server before we ask what changed, otherwise the pull can hand back the
  // pre-mutation state and the mirror briefly contradicts what the user did.
  try {
    await flushMutationsQueue(settings);
  } catch (cause) {
    // A failed flush must not block the pull: the queue is durable and retries,
    // whereas skipping the pull leaves the mirror stale for another interval.
    return {
      ...(await pull(settings)),
      reason: describe(cause, 'Queued changes could not be sent.'),
    };
  }
  return pull(settings);
}

async function pull(settings: Awaited<ReturnType<typeof loadCaptureSettings>>): Promise<BackgroundSyncResult> {
  try {
    const { applied, reset } = await syncChanges(settings);
    return { ran: true, applied, reset, reason: null };
  } catch (cause) {
    return { ran: false, applied: 0, reset: false, reason: describe(cause, 'Could not reach the server.') };
  }
}

function describe(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
