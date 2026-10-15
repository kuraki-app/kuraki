import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { __reset } from '../../test/mocks/expo-secure-store';
import { saveCaptureSettings } from './settings';
import { verifyLocalReceipt } from './reclaim-verification';
import { localVersion, type LibraryAsset } from './backup-engine';
import type { BackupReceipt } from './backup-ledger';

vi.mock('@/lib/cache/mutations',()=>({assertNoPendingRemoval:async()=>{}}));

const h = vi.hoisted(() => ({
  data: new Map<string, Uint8Array>(),
  deleted: [] as string[],
  info: vi.fn(),
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
vi.mock('expo-media-library/legacy', () => ({ getAssetInfoAsync: h.info }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
vi.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    get size() {
      return h.data.get(this.uri)?.length ?? 0;
    }
    open(mode: string) {
      expect(mode).toBe('r');
      const uri = this.uri;
      return {
        offset: 0,
        readBytes(length: number) {
          const data = h.data.get(uri)!;
          const result = data.slice(this.offset, this.offset + length);
          this.offset += length;
          return result;
        },
        close() {},
      };
    }
    async copy(target: { uri: string }) {
      h.data.set(target.uri, h.data.get(this.uri)!.slice());
    }
    delete() {
      h.deleted.push(this.uri);
      h.data.delete(this.uri);
    }
  },
}));
vi.mock('@/lib/network', () => ({ onConnectionChange: () => () => {} }));
vi.mock('@/lib/notifications', () => ({ notify: async () => {} }));
vi.mock('@/lib/prefs', () => ({
  loadPrefs: async () => ({}),
  mediaTypesFor: () => ['photo'],
}));
const settings = {
  baseURL: 'https://server.test',
  deviceToken: 'A',
  serverID: 'server',
  ownerID: 'owner',
};
const asset: LibraryAsset = {
  id: 'local',
  uri: 'file:///photo',
  filename: 'photo.jpg',
  mediaType: 'photo',
  width: 1,
  height: 1,
  creationTime: 1,
  modificationTime: 1,
  duration: 0,
};
// Published BLAKE3 abc vector; matches the server's zeebo/blake3 implementation.
const proof = {
  asset_id: 'original',
  content_hash:
    '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
  size_bytes: 3,
};
const receipt = (): BackupReceipt => ({
  localVersion: localVersion(asset),
  originals: [proof],
});
beforeEach(async () => {
  __reset();
  await saveCaptureSettings(settings);
  h.data.clear();
  h.data.set(asset.uri, new Uint8Array([97, 98, 99]));
  h.deleted = [];
  h.info.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it('requires current local bytes and a current server verification before returning a candidate', async () => {
  const fetcher = vi.fn(
    async (_url: string, init: RequestInit) =>
      new Response(
        JSON.stringify({
          status: 'verified',
          proof: JSON.parse(String(init.body)),
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await verifyLocalReceipt(settings, asset, receipt())).toEqual({
    id: 'local',
    creationTime: 1,
    size: 3,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(h.deleted).toEqual([]);
});
it('rejects edited bytes even when local id/metadata/size were unchanged', async () => {
  h.data.set(asset.uri, new Uint8Array([97, 98, 100]));
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(verifyLocalReceipt(settings, asset, receipt())).rejects.toThrow(
    'changed',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it('refuses local removal after server purge or corruption', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'original_not_found' }), {
        status: 404,
      }),
  );
  await expect(
    verifyLocalReceipt(settings, asset, receipt()),
  ).rejects.toThrow();
  expect(h.deleted).toEqual([]);
});
it('rejects a receipt from an older local version', async () => {
  await expect(
    verifyLocalReceipt(settings, { ...asset, modificationTime: 2 }, receipt()),
  ).rejects.toThrow('changed');
});
it('requires proof of both Live Photo components and skips unavailable motion', async () => {
  const live = {
    ...asset,
    mediaSubtypes: ['livePhoto'] as LibraryAsset['mediaSubtypes'],
  };
  h.info.mockResolvedValue({
    ...live,
    localUri: asset.uri,
    pairedVideoAsset: { ...asset, id: 'motion', uri: 'file:///motion' },
  });
  await expect(
    verifyLocalReceipt(settings, live, {
      localVersion: localVersion(live),
      originals: [proof],
    }),
  ).rejects.toThrow('Every component');
  h.info.mockResolvedValue({
    ...live,
    localUri: asset.uri,
    pairedVideoAsset: null,
  });
  await expect(
    verifyLocalReceipt(settings, live, {
      localVersion: localVersion(live),
      originals: [proof],
    }),
  ).rejects.toThrow('motion');
});
it('spools Android content-provider reads without buffering the entire file or changing the original', async () => {
  const content = { ...asset, uri: 'content://provider/photo' };
  h.info.mockResolvedValue({ ...content, localUri: content.uri });
  h.data.set(content.uri, new Uint8Array([97, 98, 99]));
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ status: 'verified', proof })),
  );
  await expect(
    verifyLocalReceipt(settings, content, receipt()),
  ).resolves.toMatchObject({ size: 3 });
  expect(h.data.get(content.uri)).toEqual(new Uint8Array([97, 98, 99]));
  expect(h.deleted.every((uri) => uri.startsWith('file:///cache/'))).toBe(true);
});
