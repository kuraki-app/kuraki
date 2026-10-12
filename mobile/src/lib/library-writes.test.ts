import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  resetDatabases,
} from '../../test/mocks/sqlite-driver';
const h = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync }));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after',
  getItemAsync: async (key: string) => h.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    h.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    h.secrets.delete(key);
  },
}));
const settings = {
  baseURL: 'https://server.test',
  deviceToken: 'A',
  serverID: 's',
  ownerID: 'o',
};
beforeEach(async () => {
  vi.resetModules();
  resetDatabases();
  h.secrets.clear();
  await (await import('./settings')).saveCaptureSettings(settings);
});
afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
it('keeps the latest favorite after an older offline intent and newer online write', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueFavorite('asset', true, settings);
  let favorite = false;
  const history: boolean[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    favorite = JSON.parse(String(init.body)).favorite;
    history.push(favorite);
    return response({});
  });
  const api = await import('./library-api');
  await api.setFavorite(settings, 'asset', false);
  await api.flushFavorites(settings);
  expect(history).toEqual([true, false]);
  expect(favorite).toBe(false);
});
it('does not replay older tags or album membership after newer online changes', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueMutation(
    'asset',
    'set_tags',
    { tag_ids: ['old'] },
    settings,
  );
  await mutations.enqueueAlbumAdd('asset', 'album', settings);
  const calls: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      body: JSON.parse(String(init.body)),
    });
    return response({});
  });
  const api = await import('./library-api');
  await api.setAssetTags(settings, 'asset', ['new']);
  await api.removeFromAlbum(settings, 'album', ['asset']);
  await api.flushFavorites(settings);
  expect(
    calls.filter((c) => c.url.endsWith('/tags')).map((c) => c.body),
  ).toEqual([{ ids: ['old'] }, { ids: ['new'] }]);
  expect(
    calls.filter((c) => c.url.endsWith('/album/assets')).map((c) => c.method),
  ).toEqual(['POST', 'DELETE']);
});
it('serializes simultaneous drains so a delayed old request cannot overwrite the last intent', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueFavorite('asset', true, settings);
  await mutations.enqueueFavorite('asset', false, settings);
  let release!: () => void;
  let started!: () => void;
  const beginning = new Promise<void>((resolve) => (started = resolve));
  const waiting = new Promise<void>((resolve) => (release = resolve));
  let favorite = false;
  let sends = 0;
  const send = async (m: { payload: string }) => {
    sends++;
    if (sends === 1) {
      started();
      await waiting;
    }
    favorite = JSON.parse(m.payload).favorite;
    return { status: 200, networkError: false };
  };
  const first = mutations.flushMutations(send, settings);
  await beginning;
  const second = mutations.flushMutations(send, settings);
  release();
  await Promise.all([first, second]);
  expect(sends).toBe(2);
  expect(favorite).toBe(false);
});
it('keeps a failed centrally queued intent once for later recovery', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline');
  });
  const api = await import('./library-api');
  await api.setFavorite(settings, 'asset', true);
  const { getDB } = await import('./cache/db');
  const db = await getDB(settings);
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(
    1,
  );
  vi.stubGlobal('fetch', async () => response({}));
  await api.flushFavorites(settings);
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(
    0,
  );
});
it('saving the same paired address preserves verified identity while flushing queued edits', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueFavorite('asset', true, settings);
  let applied = false;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/api/status')) return response({});
    if (url.endsWith('/identity'))
      return response({ server_id: 's', owner_id: 'o' });
    if (url.endsWith('/favorite')) {
      applied = true;
      return response({});
    }
    throw new Error('unexpected request ' + url);
  });
  const { commitServerAddress } = await import('./connection-settings');
  const result = await commitServerAddress(settings.baseURL);
  expect(result.settings).toEqual(settings);
  expect(applied).toBe(true);
});

it('does not let a delayed stale drain undo a newer acknowledged intent after response loss', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueFavorite('asset', true, settings);
  await mutations.enqueueFavorite('asset', false, settings);
  let releaseFirst!: () => void;
  let releaseStale!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
  const staleGate = new Promise<void>((resolve) => (releaseStale = resolve));
  let favorite = false;
  let firstCalls = 0;
  let staleCalls = 0;
  const first = mutations.flushMutations(async (m) => {
    if (++firstCalls === 1) {
      entered();
      await firstGate;
    }
    favorite = JSON.parse(m.payload).favorite;
    return { status: 200, networkError: false };
  }, settings);
  await started;
  const second = mutations.flushMutations(async (m) => {
    staleCalls++;
    await staleGate;
    favorite = JSON.parse(m.payload).favorite;
    return { status: 0, networkError: true };
  }, settings);
  releaseFirst();
  await first;
  releaseStale();
  await second;
  expect(favorite).toBe(false);
  expect(staleCalls).toBe(0);
  const { getDB } = await import('./cache/db');
  expect(
    await (
      await getDB(settings)
    ).getAllAsync('SELECT * FROM pending_mutations'),
  ).toHaveLength(0);
});

it('drains more than one page without leaving the newest online intent behind older writes', async () => {
  const mutations = await import('./cache/mutations');
  for (let i = 0; i < 120; i++)
    await mutations.enqueueFavorite('asset', true, settings);
  let favorite = true;
  let writes = 0;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    writes++;
    favorite = JSON.parse(String(init.body)).favorite;
    return response({});
  });
  const api = await import('./library-api');
  await api.setFavorite(settings, 'asset', false);
  expect(favorite).toBe(false);
  expect(writes).toBe(121);
});

it('does not forward the old server credential when saving another server address', async () => {
  const fetcher = vi.fn(async (_url: string) => response({}));
  vi.stubGlobal('fetch', fetcher);
  const { commitServerAddress } = await import('./connection-settings');
  const result = await commitServerAddress('https://other.test');
  expect(result.settings.deviceToken).toBe('');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://other.test/api/status');
});
it('rejects authenticated identity resolution with a credential copied to another origin', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { connectCaptureSettings } = await import('./settings');
  await expect(
    connectCaptureSettings({ ...settings, baseURL: 'https://other.test' }),
  ).rejects.toThrow('Pair with the new server address');
  expect(fetcher).not.toHaveBeenCalled();
});

it('refuses local cleanup while trash/purge of the matching server original is queued', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueuePurge('original', settings);
  await expect(
    mutations.assertNoPendingRemoval(settings, ['original']),
  ).rejects.toThrow('pending server deletion');
  await expect(
    mutations.assertNoPendingRemoval({ ...settings, ownerID: 'other-owner' }, [
      'original',
    ]),
  ).resolves.toBeUndefined();
});

it.each([408, 429])('retains a temporary %s once and applies it on recovery', async (status) => {
  const api = await import('./library-api');
  const { getDB } = await import('./cache/db');
  const db = await getDB(settings);
  vi.stubGlobal('fetch', async () => response({ error: 'try later' }, status));
  await api.setFavorite(settings, 'asset', true);
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(1);
  const send = vi.fn(async () => response({}));
  vi.stubGlobal('fetch', send);
  await api.flushFavorites(settings);
  await api.flushFavorites(settings);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(0);
});

it('reports deleted-album rejection and does not retain the rejected edit', async () => {
  vi.stubGlobal('fetch', async () => response({ error: 'album_not_found' }, 404));
  const api = await import('./library-api');
  await expect(api.addToAlbum(settings, 'gone', ['asset'])).rejects.toMatchObject({
    status: 404, message: 'album_not_found',
  });
  const { getDB } = await import('./cache/db');
  expect(await (await getDB(settings)).getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(0);
});

it('reports invalid tags even when another drain consumes the live intent', async () => {
  const mutations = await import('./cache/mutations');
  await mutations.enqueueFavorite('older', true, settings);
  const api = await import('./library-api');
  let release!: () => void;
  let started!: () => void;
  const beginning = new Promise<void>((resolve) => (started = resolve));
  const waiting = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/favorite')) { started(); await waiting; return response({}); }
    return response({ error: 'unknown_tag' }, 400);
  });
  const first = api.flushFavorites(settings);
  await beginning;
  const pending = api.setAssetTags(settings, 'asset', ['gone']);
  const rejected = expect(pending).rejects.toMatchObject({ status: 400, message: 'unknown_tag' });
  const { getDB } = await import('./cache/db');
  const db = await getDB(settings);
  await vi.waitFor(async () => expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(2));
  release();
  await first;
  await rejected;
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(0);
});

it('can switch credentials after canceling sync stalled in a native cursor read', async () => {
  const api = await import('./library-api');
  const { getDB } = await import('./cache/db');
  const { saveCaptureSettings, loadCaptureSettings, StaleConnectionError } = await import('./settings');
  const db = await getDB(settings);
  let release!: () => void;
  let started!: () => void;
  const beginning = new Promise<void>((resolve) => (started = resolve));
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const read = db.getFirstAsync.bind(db);
  vi.spyOn(db, 'getFirstAsync').mockImplementation(async (sql, ...args) => {
    if (sql.includes("key = 'cursor'")) { started(); await waiting; }
    return read(sql, ...args);
  });
  const controller = new AbortController();
  const pending = api.syncChanges(settings, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await beginning;
  controller.abort();
  await rejected;
  const next = { ...settings, ownerID: 'other', deviceToken: 'B' };
  await saveCaptureSettings(next);
  expect(await loadCaptureSettings()).toEqual(next);
  vi.stubGlobal('fetch', vi.fn());
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).not.toHaveBeenCalled();
  // The late cache operation cannot move work into the freshly paired mirror.
  expect(await (await getDB(next)).getAllAsync('SELECT * FROM assets')).toHaveLength(0);
  await expect(api.syncChanges(settings)).rejects.toBeInstanceOf(StaleConnectionError);
});

it('keeps durable intent out of a failed concurrent mirror transaction', async () => {
  const { getDB } = await import('./cache/db');
  const { upsertAssets } = await import('./cache/assets');
  const { enqueueFavorite } = await import('./cache/mutations');
  const db = await getDB(settings);
  let release!: () => void;
  let started!: () => void;
  const beginning = new Promise<void>((resolve) => (started = resolve));
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const run = db.runAsync.bind(db);
  vi.spyOn(db, 'runAsync').mockImplementation(async (sql, ...args) => {
    if (sql.includes('INSERT INTO assets')) {
      started(); await waiting;
      throw new Error('failed cache refresh');
    }
    return run(sql, ...args);
  });
  const mirroring = upsertAssets([{ id: 'asset', filename: 'a.jpg', media_type: 'image', favorite: false, web_viewable: true }], settings);
  const rejected = expect(mirroring).rejects.toThrow('failed cache refresh');
  await beginning;
  let acknowledged = false;
  const intent = enqueueFavorite('asset', true, settings).then(() => { acknowledged = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(acknowledged).toBe(false); // acknowledgement waits for its own commit
  release();
  await rejected;
  await intent;
  expect(await db.getAllAsync('SELECT * FROM pending_mutations')).toHaveLength(1);
  expect(await db.getAllAsync('SELECT * FROM assets')).toHaveLength(0);
});
