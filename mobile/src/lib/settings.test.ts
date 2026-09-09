import { describe, expect, it } from 'vitest';

import { switchedLibrary } from '@/lib/settings';

const at = (baseURL: string, deviceToken: string) => ({ baseURL, deviceToken });

// The bug this guards: the SQLite mirror and the delta-sync cursor are keyed by
// nothing at all. Repointing the app at another server left the previous
// library's photos in the cache AND handed the new server a cursor from the old
// one's change_log — which answers "nothing new", so the app reported
// "Connected" while showing someone else's library indefinitely.
describe('switchedLibrary', () => {
  it('is true when the server address changes', () => {
    expect(switchedLibrary(at('http://192.168.1.40:3000', 't1'), at('https://photos.example.com', 't1'))).toBe(true);
  });

  it('is true when the device token changes at the same address', () => {
    // Same server, different account — and Kuraki isolates libraries per owner,
    // so this is as much a different library as a different host is.
    expect(switchedLibrary(at('http://nas:3000', 't1'), at('http://nas:3000', 't2'))).toBe(true);
  });

  it('is false for first-time setup, which has no previous library to leave', () => {
    expect(switchedLibrary(at('', ''), at('http://nas:3000', ''))).toBe(false);
    expect(switchedLibrary(at('http://nas:3000', ''), at('http://nas:3000', 't1'))).toBe(false);
  });

  it('is false when nothing moved', () => {
    expect(switchedLibrary(at('http://nas:3000', 't1'), at('http://nas:3000', 't1'))).toBe(false);
  });

  it('is false when a token is only cleared, not replaced', () => {
    // Revocation drops the token and leaves the library where it was; the
    // mirror is what the app shows while disconnected, so it must survive.
    expect(switchedLibrary(at('http://nas:3000', 't1'), at('http://nas:3000', ''))).toBe(false);
  });
});
