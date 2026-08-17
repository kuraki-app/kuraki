// The mobile connection model distinguishes two failures that demand opposite
// responses. `unreachable` is a network/address problem — the token is still
// valid, so a probe recovering flips us back to online. `disconnected` is a
// server-side 401 (token revoked); reachability is irrelevant and only an
// explicit re-pair (`reconnected`) can leave that state. This keeps a revoked
// phone from silently looking healthy the moment Wi-Fi returns.
export type ConnectionState = 'online' | 'unreachable' | 'disconnected';
export type ConnectionEvent = 'probe-ok' | 'probe-unreachable' | 'auth-lost' | 'reconnected';

export function nextConnectionState(current: ConnectionState, event: ConnectionEvent): ConnectionState {
  if (event === 'auth-lost') return 'disconnected';
  if (event === 'reconnected') return 'online';
  if (current === 'disconnected') return 'disconnected'; // probe results cannot clear a revoke
  switch (event) {
    case 'probe-ok':
      return 'online';
    case 'probe-unreachable':
      return 'unreachable';
  }
}

/** How long to wait before calling an address unreachable.
 *
 * This is the whole reason first-run setup felt broken. `fetch` has no timeout
 * of its own, so a routable-looking but dead address — wrong subnet, server not
 * started, firewall dropping packets — hung until the OS gave up, which on iOS
 * is roughly 60-75 seconds of a spinner saying "Checking…". The address was
 * usually wrong by one digit and the person had no way to know.
 *
 * 4s is chosen against the work being done, not plucked: /api/status is an
 * unauthenticated handler that touches no disk, so on any network where the
 * server is actually reachable it answers in tens of milliseconds. Anything
 * still outstanding at 4s is not slow, it is absent — and being told that
 * quickly is what lets someone fix the typo. */
const PROBE_TIMEOUT_MS = 4000;

// probeServer hits the public status endpoint (no credentials needed) so a wrong
// address is diagnosed before any authenticated call.
export async function probeServer(baseURL: string, signal?: AbortSignal): Promise<'ok' | 'unreachable'> {
  if (!baseURL) return 'unreachable';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // A caller's own signal still cancels: screens abort this probe when they
  // unmount, and losing that would leave the request running past the screen.
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${baseURL}/api/status`, { signal: controller.signal });
    return response.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
