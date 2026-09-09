import { beforeEach, describe, expect, it } from 'vitest';

import { __reset } from '../../test/mocks/expo-secure-store';

import {
  clearDeviceToken,
  loadCaptureSettings,
  saveCaptureSettings,
  switchedLibrary,
} from '@/lib/settings';

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

// A 401 must only be able to clear the credential that actually failed.
//
// reportAuthLost clears the stored token asynchronously, and nothing ordered
// that against pairing storing a new one. A rejection already in flight when the
// user paired deleted the token pairing had just written: the server kept an
// active device row, the app showed "Not paired", and a "Kuraki disconnected"
// notification arrived seconds after a successful pair. Seen on device against a
// real server.
describe('clearDeviceToken', () => {
  beforeEach(() => __reset());
  it('is a no-op once the failed token has been replaced', async () => {
    await saveCaptureSettings(at('http://nas:39170', 'fresh-token'));
    await clearDeviceToken('stale-token');
    expect((await loadCaptureSettings()).deviceToken).toBe('fresh-token');
  });

  it('clears the token when it is still the one that failed', async () => {
    await saveCaptureSettings(at('http://nas:39170', 'doomed'));
    await clearDeviceToken('doomed');
    expect((await loadCaptureSettings()).deviceToken).toBe('');
  });

  it('clears unconditionally when no token is named, for explicit sign-out', async () => {
    await saveCaptureSettings(at('http://nas:39170', 'whatever'));
    await clearDeviceToken();
    expect((await loadCaptureSettings()).deviceToken).toBe('');
  });
});
