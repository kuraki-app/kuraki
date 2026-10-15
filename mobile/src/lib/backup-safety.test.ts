import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  openDatabaseAsync,
  resetDatabases,
  databaseNames,
} from '../../test/mocks/sqlite-driver';

const h = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  storage: new Map<string, string>(),
  upload: vi.fn(),
  network: 'wifi',
  appState: 'background',
  available: true,
  pages: vi.fn(),
  asset: {
    id: 'local-1',
    filename: 'photo.jpg',
    uri: 'file:///photo.jpg',
    creationTime: 1_577_836_800_000,
    modificationTime: 1_577_836_800_000,
    mediaType: 'photo',
    mediaSubtypes: [] as string[],
  },
}));
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
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => h.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      h.storage.set(key, value);
    },
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return h.appState;
    },
  },
}));
vi.mock('expo-media-library/legacy', () => ({
  requestPermissionsAsync: async () => ({ granted: true }),
  getPermissionsAsync: async () => ({ granted: true }),
  getAssetsAsync: (...args: unknown[]) => h.pages(...args),
  getAssetInfoAsync: async () => ({ ...h.asset }),
  getAlbumsAsync: async () => [],
}));
vi.mock('@/lib/capture-api', () => ({
  uploadFile: h.upload,
  availableOriginals: async () => new Set(h.available ? ['original-A'] : []),
}));
vi.mock('@/lib/network', () => ({
  currentConnection: async () => ({ type: h.network, isConnected: true }),
  onConnectionChange: () => () => {},
  evaluateNetworkGate: (c: { type: string }, wifiOnly: boolean) =>
    !wifiOnly || c.type === 'wifi' ? 'allowed' : 'metered',
  gateMessage: () => 'Waiting for Wi-Fi.',
}));
vi.mock('@/lib/notifications', () => ({ notify: async () => {} }));
vi.mock('@/lib/prefs', () => ({
  loadPrefs: async () => ({ backupPhotos: true, backupVideos: true }),
  mediaTypesFor: () => ['photo', 'video'],
}));
const connection = {
  baseURL: 'https://server.test',
  deviceToken: 'A',
  serverID: 'server',
  ownerID: 'owner-A',
};
const proof = {
  asset_id: 'original-A',
  content_hash: 'a'.repeat(64),
  size_bytes: 4,
};
let engine:
  InstanceType<typeof import('./backup-engine').BackupEngine> | undefined;
beforeEach(async () => {
  engine?.dispose();
  resetDatabases();
  vi.resetModules();
  h.secrets.clear();
  h.storage.clear();
  h.network = 'wifi';
  h.appState = 'background';
  h.available = true;
  h.pages
    .mockReset()
    .mockResolvedValue({ assets: [h.asset], hasNextPage: false });
  h.upload.mockReset();
  h.asset.mediaSubtypes = [];
  h.asset.modificationTime = h.asset.creationTime;
  const { saveCaptureSettings } = await import('./settings');
  await saveCaptureSettings(connection);
});
afterEach(() => {
  vi.useRealTimers();
  engine?.dispose();
  engine = undefined;
});
async function freshEngine() {
  const { BackupEngine } = await import('./backup-engine');
  engine = new BackupEngine();
  return engine;
}

it('does not turn a queued-only upload into backup or deletion permission', async () => {
  h.upload.mockResolvedValue({ id: 'upload', status: 'queued' });
  const e = await freshEngine();
  await e.run();
  expect(e.snapshot().done).toBe(0);
  const ledger = await import('./backup-ledger');
  const { libraryKey } = await import('./settings');
  expect(await ledger.loadBackedUpIds(libraryKey(connection))).toEqual(
    new Set(),
  );
});
it('records only original receipts and scopes them across server/account/process changes', async () => {
  h.upload.mockResolvedValue({ id: 'upload', status: 'completed', proof });
  let e = await freshEngine();
  await e.run();
  expect(e.snapshot().done).toBe(1);
  e.dispose();
  const settings = await import('./settings');
  const b = { ...connection, deviceToken: 'B', ownerID: 'owner-B' };
  await settings.saveCaptureSettings(b);
  e = await freshEngine();
  await e.run();
  expect(h.upload).toHaveBeenCalledTimes(2);
  const ledger = await import('./backup-ledger');
  expect(await ledger.backedUpCount(settings.libraryKey(b))).toBe(1);
  expect(await ledger.backedUpCount(settings.libraryKey(connection))).toBe(1);
});
it('single-flights overlapping runs before asynchronous preflight', async () => {
  h.upload.mockResolvedValue({ id: 'upload', status: 'completed', proof });
  const e = await freshEngine();
  const first = e.run();
  const second = e.run();
  expect(second).toBe(first);
  await Promise.all([first, second]);
  expect(h.upload).toHaveBeenCalledTimes(1);
});
it('does not reuse a receipt for a changed local version', async () => {
  h.upload.mockResolvedValue({ id: 'upload', status: 'completed', proof });
  const e = await freshEngine();
  await e.run();
  h.asset.modificationTime++;
  await e.run();
  expect(h.upload).toHaveBeenCalledTimes(2);
});
it('does not give legacy id-only history ownership or reclamation permission', async () => {
  const ledger = await import('./backup-ledger');
  await ledger.importLegacyDoneIds(['local-1']);
  expect(await ledger.loadBackedUpIds()).toEqual(new Set());
  const { libraryKey } = await import('./settings');
  expect(await ledger.loadBackedUpIds(libraryKey(connection))).toEqual(
    new Set(),
  );
});
it('stores session progress independently for different libraries and versions', async () => {
  const ledger = await import('./backup-ledger');
  await ledger.saveResumableUpload(
    'local-1',
    { sessionId: 'upload-A', sizeBytes: 4, offsetBytes: 4 },
    'A',
    'v1',
  );
  expect(await ledger.loadResumableUpload('local-1', 'B', 'v1')).toBeNull();
  expect(await ledger.loadResumableUpload('local-1', 'A', 'v2')).toBeNull();
  expect(
    (await ledger.loadResumableUpload('local-1', 'A', 'v1'))?.offsetBytes,
  ).toBe(4);
});
it('opens independent SQLite mirrors for different owners and ignores the unscoped cache', async () => {
  const { getDB } = await import('./cache/db');
  await getDB(connection);
  await getDB({ ...connection, deviceToken: 'B', ownerID: 'B' });
  expect(
    databaseNames().filter((name) => name.startsWith('kuraki-cache-')),
  ).toHaveLength(2);
  expect(databaseNames()).not.toContain('kuraki.db');
});

it('reuploads originals missing after purge or an older restore with unchanged identity', async () => {
  h.upload.mockResolvedValue({ id: 'u', status: 'completed', proof });
  const e = await freshEngine();
  await e.run();
  h.available = false;
  await e.run();
  expect(h.upload).toHaveBeenCalledTimes(2);
  expect(e.snapshot().done).toBe(1);
});
it('makes historical progress when every recent item fails', async () => {
  const recent = Array.from({ length: 100 }, (_, i) => ({
    ...h.asset,
    id: 'recent-' + i,
  }));
  h.pages.mockImplementation(async ({ after }: { after?: string }) =>
    after
      ? { assets: [{ ...h.asset, id: 'older' }], hasNextPage: false }
      : { assets: recent, hasNextPage: true, endCursor: 'history' },
  );
  h.upload.mockRejectedValue(new Error('Unsupported media'));
  const e = await freshEngine();
  await e.run();
  expect(h.pages).toHaveBeenCalledWith(
    expect.objectContaining({ after: 'history' }),
  );
  expect(h.upload).toHaveBeenCalledTimes(101);
});

it('does not starve position 51 of a short library after fifty failures', async () => {
  const photos = Array.from({ length: 51 }, (_, i) => ({
    ...h.asset,
    id: 'item-' + i,
  }));
  h.pages.mockResolvedValue({ assets: photos, hasNextPage: false });
  h.upload.mockRejectedValue(new Error('unavailable'));
  const e = await freshEngine();
  await e.run();
  expect(h.upload).toHaveBeenCalledTimes(51);
});

it('continues checking a manually requested pending original without enabling auto backup', async () => {
  vi.useFakeTimers();
  h.appState = 'active';
  const { RequestError } = await import('./request');
  h.upload
    .mockRejectedValueOnce(new RequestError('Waiting for import', 202, true))
    .mockResolvedValue({ id: 'u', status: 'completed', proof });
  const e = await freshEngine();
  await e.run();
  expect(e.snapshot().auto).toBe(false);
  await vi.advanceTimersByTimeAsync(15000);
  expect(e.snapshot().done).toBe(1);
  expect(h.upload).toHaveBeenCalledTimes(2);
});

it('does not upload on a late background wake after automatic backup was disabled', async () => {
  h.upload.mockResolvedValue({ id: 'u', status: 'completed', proof });
  const e = await freshEngine();
  await e.run({ background: true });
  expect(h.upload).not.toHaveBeenCalled();
  expect(e.snapshot().message).toBe('Automatic backup is off.');
});
