import * as Network from 'expo-network';

import type { Connection, ConnectionType } from '@/lib/network-policy';

export { evaluateNetworkGate, gateMessage } from '@/lib/network-policy';
export type { Connection, ConnectionType, NetworkGate } from '@/lib/network-policy';

function toConnectionType(type: Network.NetworkStateType | undefined): ConnectionType {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case undefined:
    case Network.NetworkStateType.UNKNOWN:
      return 'unknown';
    default:
      // ETHERNET, VPN, BLUETOOTH, WIMAX -- connected and not billed by the
      // byte, so treated like Wi-Fi by the policy next door.
      return 'other';
  }
}

/**
 * currentConnection reads the live network state.
 *
 * A failed read degrades to "connected, unknown type" rather than throwing:
 * the policy allows unknown connections, so a flaky read lets backup proceed
 * instead of stalling it indefinitely behind an error nobody sees.
 */
export async function currentConnection(): Promise<Connection> {
  try {
    const state = await Network.getNetworkStateAsync();
    return { isConnected: state.isConnected ?? null, type: toConnectionType(state.type) };
  } catch {
    return { isConnected: null, type: 'unknown' };
  }
}
