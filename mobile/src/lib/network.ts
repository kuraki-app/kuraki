import * as Network from 'expo-network';

import type { Connection, ConnectionType } from '@/lib/network-policy';

export { evaluateNetworkGate, gateMessage } from '@/lib/network-policy';
export type {
  Connection,
  ConnectionType,
  NetworkGate,
} from '@/lib/network-policy';

function toConnectionType(
  type: Network.NetworkStateType | undefined,
): ConnectionType {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case undefined:
    case Network.NetworkStateType.UNKNOWN:
      return 'unknown';
    case Network.NetworkStateType.ETHERNET:
      return 'other';
    default:
      return 'unknown';
  }
}

/**
 * currentConnection reads the live network state.
 *
 * Failed/unknown reads fail closed when Wi-Fi-only is enabled. A known
 * connection or an explicit cellular preference is needed before uploading.
 */
export async function currentConnection(): Promise<Connection> {
  try {
    const state = await Network.getNetworkStateAsync();
    return {
      isConnected: state.isConnected ?? null,
      type: toConnectionType(state.type),
    };
  } catch {
    return { isConnected: null, type: 'unknown' };
  }
}

export function onConnectionChange(
  listener: (connection: Connection) => void,
): () => void {
  try {
    const subscription = Network.addNetworkStateListener((state) =>
      listener({
        isConnected: state.isConnected ?? null,
        type: toConnectionType(state.type),
      }),
    );
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
