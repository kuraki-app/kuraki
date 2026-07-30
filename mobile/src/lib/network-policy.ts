/**
 * Pure policy for "may automatic backup run on this connection?".
 *
 * Deliberately free of imports -- expo-network pulls the React Native runtime
 * in with it, which the unit suite cannot parse (see vitest.config.ts: pure
 * logic only). Keeping the decision here means the rule that actually protects
 * a user's mobile data allowance is tested, while the native read next door
 * stays a thin, untestable shim.
 */

/** Connection kind, narrowed to what the decision needs. */
export type ConnectionType = 'wifi' | 'cellular' | 'other' | 'unknown';

export type Connection = {
  /** null when the state could not be read. */
  isConnected: boolean | null;
  type: ConnectionType;
};

export type NetworkGate = 'allowed' | 'offline' | 'metered';

/**
 * evaluateNetworkGate decides whether a run may proceed.
 *
 * Unknown types are allowed rather than refused: VPNs and some tethering
 * setups report an unclassifiable type, and silently stopping backup on a
 * network we merely failed to identify is a worse failure than an occasional
 * unexpected upload. Cellular is the only type positively refused.
 */
export function evaluateNetworkGate(connection: Connection, wifiOnly: boolean): NetworkGate {
  if (connection.isConnected === false) return 'offline';
  if (!wifiOnly) return 'allowed';
  if (connection.type === 'cellular') return 'metered';
  return 'allowed';
}

/** Human-readable reason for a blocked run, for the Backup screen. */
export function gateMessage(gate: NetworkGate): string | null {
  switch (gate) {
    case 'metered':
      return 'Waiting for Wi-Fi. Turn off "Wi-Fi only" to back up over cellular.';
    case 'offline':
      return 'No connection. Backup will resume automatically.';
    default:
      return null;
  }
}
