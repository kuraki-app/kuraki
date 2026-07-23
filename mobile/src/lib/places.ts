import type { LibraryAsset } from '@/lib/library-api';

// A located asset: the LibraryAsset subset plus non-null GPS. `/api/places`
// only returns assets that carry GPS, so callers narrow to this shape.
export type PlacePoint = Pick<
  LibraryAsset,
  | 'id'
  | 'filename'
  | 'media_type'
  | 'taken_at'
  | 'taken_day'
  | 'favorite'
  | 'web_viewable'
  | 'thumbnail_url'
  | 'preview_url'
  | 'place_city'
  | 'place_country'
> & { gps_lat: number; gps_lon: number };

export type PlaceFeature = {
  type: 'Feature';
  id: string;
  properties: { assetId: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type PlacesFeatureCollection = {
  type: 'FeatureCollection';
  features: PlaceFeature[];
};

// buildPlacesGeoJSON turns located assets into a GeoJSON FeatureCollection for
// a MapLibre ShapeSource. GeoJSON is [longitude, latitude] — the opposite of
// the usual lat/lon spoken order.
export function buildPlacesGeoJSON(points: PlacePoint[]): PlacesFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      id: p.id,
      properties: { assetId: p.id },
      geometry: { type: 'Point', coordinates: [p.gps_lon, p.gps_lat] },
    })),
  };
}

export type PlacesViewState = 'loading' | 'offline' | 'empty' | 'ready';

// placesViewState resolves what the Places segment renders. Places is
// online-first (tiles + points need the network); an unreachable server with
// nothing loaded shows the connection state, a reachable server with zero
// located photos shows the empty state.
export function placesViewState(input: {
  loading: boolean;
  reachable: boolean;
  count: number;
}): PlacesViewState {
  if (input.loading) return 'loading';
  if (input.count > 0) return 'ready';
  if (!input.reachable) return 'offline';
  return 'empty';
}
