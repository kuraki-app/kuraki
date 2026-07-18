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

// probeServer hits the public status endpoint (no credentials needed) so a wrong
// address is diagnosed before any authenticated call.
export async function probeServer(baseURL: string, signal?: AbortSignal): Promise<'ok' | 'unreachable'> {
  if (!baseURL) return 'unreachable';
  try {
    const response = await fetch(`${baseURL}/api/status`, { signal });
    return response.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
