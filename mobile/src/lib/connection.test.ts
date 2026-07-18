import { describe, expect, it } from 'vitest';
import { nextConnectionState } from '@/lib/connection';

describe('nextConnectionState', () => {
  it('a successful probe means online', () => {
    expect(nextConnectionState('unreachable', 'probe-ok')).toBe('online');
  });
  it('a failed probe from online means unreachable', () => {
    expect(nextConnectionState('online', 'probe-unreachable')).toBe('unreachable');
  });
  it('auth-lost always wins over reachability', () => {
    expect(nextConnectionState('online', 'auth-lost')).toBe('disconnected');
    expect(nextConnectionState('unreachable', 'auth-lost')).toBe('disconnected');
  });
  it('a probe result never clears a disconnected (revoked) state', () => {
    expect(nextConnectionState('disconnected', 'probe-ok')).toBe('disconnected');
    expect(nextConnectionState('disconnected', 'probe-unreachable')).toBe('disconnected');
  });
  it('only an explicit reconnect clears disconnected', () => {
    expect(nextConnectionState('disconnected', 'reconnected')).toBe('online');
  });
});
