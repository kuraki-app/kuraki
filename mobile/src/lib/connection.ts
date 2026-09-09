import { serverURLCandidates } from '@/lib/url';

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

/**
 * resolveServerURL finds which of the addresses a typed input could mean is
 * actually answering, and returns it.
 *
 * A bare hostname does not say whether the server is a box on the LAN
 * (plain HTTP on :3000) or a domain behind a reverse proxy (HTTPS on 443).
 * `serverURLCandidates` orders the guesses; this tries them in that order and
 * keeps the first that responds, so someone typing `photos.example.com` reaches
 * their proxied server and someone typing `192.168.1.40` reaches the box —
 * without either having to know to type a scheme.
 *
 * Returns null when nothing answered, which the caller reports as an
 * unreachable address. The probes run in sequence, not in parallel: the second
 * candidate only matters when the first failed, and firing both would open a
 * connection to an address the user did not ask for on every successful setup.
 */
export async function resolveServerURL(input: string, signal?: AbortSignal): Promise<string | null> {
  for (const candidate of serverURLCandidates(input)) {
    if (signal?.aborted) return null;
    if ((await probeServer(candidate, signal)) === 'ok') return candidate;
  }
  return null;
}
