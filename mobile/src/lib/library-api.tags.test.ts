import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAssetTags, fetchLibrary } from './library-api';

const settings = { baseURL: 'http://h:3000', deviceToken: 'tok' } as any;

// Capture the URL each fetch is called with so we can assert query params.
function mockJSON(body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: unknown) => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe('fetchAssetTags', () => {
  it("returns an asset's tags", async () => {
    mockJSON({ tags: [{ id: 't1', name: 'Beach' }, { id: 't2', name: 'Sunset' }] });
    const tags = await fetchAssetTags(settings, 'a1');
    expect(tags.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('fetchLibrary tag filter', () => {
  it('forwards tag as a query param (and stays uncached because it is filtered)', async () => {
    const fn = mockJSON({ assets: [], next_cursor: undefined });
    await fetchLibrary(settings, { tag: 't1' });
    const url = fn.mock.calls[0][0] as string;
    expect(url).toContain('/api/search?');
    expect(url).toContain('tag=t1');
  });
});
