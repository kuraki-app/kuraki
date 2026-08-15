import { describe, expect, it } from 'vitest';
import { nextConnectionState, probeServer } from '@/lib/connection';

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

describe('probeServer timeouts', () => {
  it('gives up rather than hanging on an address that never answers', async () => {
    const original = globalThis.fetch;
    // A fetch that never settles unless aborted — exactly what a dead-but-
    // routable address does at the TCP level.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;

    try {
      const started = Date.now();
      const result = await probeServer('http://192.0.2.1:3000');
      const waited = Date.now() - started;

      expect(result).toBe('unreachable');
      // Without a timeout this resolved only when the OS gave up — ~60-75s on
      // iOS. The exact bound matters less than that one exists.
      expect(waited).toBeLessThan(6000);
    } finally {
      globalThis.fetch = original;
    }
  }, 10000);
});
