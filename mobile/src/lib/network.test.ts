import { describe, expect, it } from 'vitest';

// Imports the pure policy, not ./network -- expo-network drags the React
// Native runtime in and this suite is node-only (see vitest.config.ts).
import { evaluateNetworkGate, gateMessage, type Connection } from './network-policy';

const wifi: Connection = { isConnected: true, type: 'wifi' };
const cellular: Connection = { isConnected: true, type: 'cellular' };
const unknown: Connection = { isConnected: true, type: 'unknown' };

describe('evaluateNetworkGate', () => {
  it('allows Wi-Fi when restricted to Wi-Fi', () => {
    expect(evaluateNetworkGate(wifi, true)).toBe('allowed');
  });

  it('blocks cellular when restricted to Wi-Fi', () => {
    expect(evaluateNetworkGate(cellular, true)).toBe('metered');
  });

  it('allows cellular when the restriction is off', () => {
    expect(evaluateNetworkGate(cellular, false)).toBe('allowed');
  });

  it('reports offline before considering the restriction', () => {
    // Offline must win over 'metered' so the user is told the useful thing.
    expect(evaluateNetworkGate({ isConnected: false, type: 'wifi' }, true)).toBe('offline');
    expect(evaluateNetworkGate({ isConnected: false, type: 'wifi' }, false)).toBe('offline');
  });

  it('allows ethernet/VPN and similar un-metered types', () => {
    expect(evaluateNetworkGate({ isConnected: true, type: 'other' }, true)).toBe('allowed');
  });

  it('allows an unclassifiable connection rather than stranding backup', () => {
    // VPNs and some tethering setups report UNKNOWN. Refusing those would
    // silently stop backup on networks we merely failed to identify, which is
    // worse than an occasional unexpected upload.
    expect(evaluateNetworkGate(unknown, true)).toBe('allowed');
  });

  it('treats an unreadable connection state as allowed', () => {
    // currentConnection degrades to isConnected: null when the read throws.
    expect(evaluateNetworkGate({ isConnected: null, type: 'unknown' }, true)).toBe('allowed');
  });
});

describe('gateMessage', () => {
  it('explains how to override the Wi-Fi restriction', () => {
    expect(gateMessage('metered')).toContain('Wi-Fi only');
  });

  it('says offline recovery is automatic', () => {
    expect(gateMessage('offline')).toContain('automatically');
  });

  it('has nothing to say when allowed', () => {
    expect(gateMessage('allowed')).toBeNull();
  });
});
