import { describe, expect, it } from 'vitest';
import { buildPlacesGeoJSON, placesViewState, type PlacePoint } from './places';

const pt = (id: string, lat: number, lon: number): PlacePoint => ({
  id,
  filename: `${id}.jpg`,
  media_type: 'image',
  taken_at: '2026-01-01T00:00:00Z',
  taken_day: '2026-01-01',
  favorite: false,
  web_viewable: true,
  thumbnail_url: `/api/assets/${id}/thumb`,
  preview_url: undefined,
  place_city: 'Paris',
  place_country: 'France',
  gps_lat: lat,
  gps_lon: lon,
});

describe('buildPlacesGeoJSON', () => {
  it('maps points to a FeatureCollection with [lon, lat] coordinates', () => {
    const fc = buildPlacesGeoJSON([pt('a', 48.8566, 2.3522)]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]).toMatchObject({
      type: 'Feature',
      id: 'a',
      properties: { assetId: 'a' },
      geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
    });
  });

  it('returns an empty collection for no points', () => {
    expect(buildPlacesGeoJSON([]).features).toEqual([]);
  });
});

describe('placesViewState', () => {
  it('is loading while fetching', () => {
    expect(placesViewState({ loading: true, reachable: true, count: 0 })).toBe('loading');
  });
  it('is offline when unreachable and nothing loaded', () => {
    expect(placesViewState({ loading: false, reachable: false, count: 0 })).toBe('offline');
  });
  it('is empty when reachable with zero located photos', () => {
    expect(placesViewState({ loading: false, reachable: true, count: 0 })).toBe('empty');
  });
  it('is ready when points exist', () => {
    expect(placesViewState({ loading: false, reachable: true, count: 5 })).toBe('ready');
  });
});
