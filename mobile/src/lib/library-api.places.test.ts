import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPlaces, fetchPlacesSummary } from './library-api';

const settings = { baseURL: 'http://host:3000', deviceToken: 'tok' } as any;

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchPlaces', () => {
  it('returns only assets with GPS, narrowed to PlacePoint', async () => {
    mockFetchOnce({
      assets: [
        { id: 'a', gps_lat: 1, gps_lon: 2, filename: 'a.jpg', media_type: 'image', favorite: false, thumbnail_url: '/t' },
        { id: 'b', gps_lat: null, gps_lon: null, filename: 'b.jpg', media_type: 'image', favorite: false },
      ],
    });
    const pts = await fetchPlaces(settings);
    expect(pts.map((p) => p.id)).toEqual(['a']);
    expect(pts[0].gps_lat).toBe(1);
  });
});

describe('fetchPlacesSummary', () => {
  it('returns the place groups array', async () => {
    mockFetchOnce({ places: [{ city: 'Paris', country: 'France', count: 3, cover_asset_id: 'c', cover_thumb_url: '/t' }] });
    const groups = await fetchPlacesSummary(settings);
    expect(groups).toHaveLength(1);
    expect(groups[0].city).toBe('Paris');
  });
});
