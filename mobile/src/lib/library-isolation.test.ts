import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { __reset } from '../../test/mocks/expo-secure-store';
import {
  saveCaptureSettings,
  loadCaptureSettings,
  libraryKey,
  clearDeviceToken,
  withActiveConnection,
  StaleConnectionError,
} from './settings';
import { fetchLibrary } from './library-api';
import { clearAuthLost, isAuthLost, reportAuthLost } from './session';

const writes = vi.hoisted(() => ({ upsert: vi.fn(async () => {}) }));
vi.mock('@/lib/cache/assets', () => ({ upsertAssets: writes.upsert }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => {}) }));
const a = {
  baseURL: 'https://audit.test',
  deviceToken: 'A',
  serverID: 'server',
  ownerID: 'owner-A',
};
const b = { ...a, deviceToken: 'B', ownerID: 'owner-B' };
beforeEach(async () => {
  __reset();
  clearAuthLost();
  writes.upsert.mockClear();
  await saveCaptureSettings(a);
});
afterEach(() => vi.unstubAllGlobals());

describe('library transition ownership', () => {
  it('keeps a verified library namespace across credential rotation', () => {
    expect(libraryKey(a)).toBe(libraryKey({ ...a, deviceToken: 'rotated' }));
    expect(libraryKey(a)).not.toBe(libraryKey(b));
    expect(libraryKey(a)).not.toBe(
      libraryKey({ ...a, baseURL: 'https://other.test' }),
    );
  });
  it('re-pairing after revocation selects the new owner namespace', async () => {
    await clearDeviceToken(a);
    await saveCaptureSettings(b);
    expect(libraryKey(await loadCaptureSettings())).toBe(libraryKey(b));
    expect(libraryKey(await loadCaptureSettings())).not.toBe(libraryKey(a));
  });
  it('rejects an old response before returning or writing private cache data', async () => {
    let release!: (response: Response) => void;
    const started = new Promise<void>((resolve) =>
      vi.stubGlobal('fetch', () => {
        resolve();
        return new Promise<Response>((r) => {
          release = r;
        });
      }),
    );
    const pending = fetchLibrary(a, {});
    const rejected =
      expect(pending).rejects.toBeInstanceOf(StaleConnectionError);
    await started;
    await saveCaptureSettings(b);
    release(
      new Response(
        JSON.stringify({
          assets: [{ id: 'private-A', filename: 'private-A.jpg' }],
        }),
      ),
    );
    await rejected;
    expect(writes.upsert).not.toHaveBeenCalled();
  });
  it('makes a stale failure unable to flag or clear a fresh pairing', async () => {
    await saveCaptureSettings(b);
    reportAuthLost(a);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await loadCaptureSettings()).deviceToken).toBe('B');
    expect(isAuthLost()).toBe(false);
  });
  it('holds identity stable while a bounded cache transaction commits', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const write = withActiveConnection(a, async () => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      expect((await loadCaptureSettings()).ownerID).toBe('owner-A');
    });
    await started;
    const switching = saveCaptureSettings(b);
    release();
    await write;
    await switching;
    expect((await loadCaptureSettings()).ownerID).toBe('owner-B');
  });
  it('serializes the trip query instead of fetching the unfiltered timeline', async () => {
    const fetcher = vi.fn(
      async (_url: string) => new Response(JSON.stringify({ assets: [] })),
    );
    vi.stubGlobal('fetch', fetcher);
    await fetchLibrary(a, { trip: 'trip-1' });
    expect(
      new URL(String(fetcher.mock.calls[0][0])).searchParams.get('trip'),
    ).toBe('trip-1');
  });
});
