import { describe, expect, it } from 'vitest';

import { assetFacts } from '@/lib/asset-facts';
import type { AssetDetail } from '@/lib/library-api';

function detail(over: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: 'a1',
    filename: 'IMG_0001.jpg',
    media_type: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 7_497_318,
    width: 4032,
    height: 3024,
    camera_make: '',
    camera_model: '',
    place_city: undefined,
    place_country: undefined,
    taken_at: undefined,
    archived: false,
    hidden: false,
    favorite: false,
    rating: 0,
    duration_ms: 0,
    stack_size: 1,
    created_at: '2026-01-01T00:00:00Z',
    original_url: '/o',
    view_url: '/v',
    web_viewable: true,
    ...over,
  } as AssetDetail;
}

describe('assetFacts', () => {
  it('always yields a file row, with size and dimensions', () => {
    const [file] = assetFacts(detail());
    expect(file.key).toBe('file');
    expect(file.primary).toBe('IMG_0001.jpg');
    expect(file.secondary).toBe('7.1 MB · 4032 × 3024');
  });

  it('falls back to the MIME type when there is no size or dimensions', () => {
    // The file row is the one row that should always say something.
    const [file] = assetFacts(detail({ size_bytes: 0, width: 0, height: 0 }));
    expect(file.secondary).toBe('image/jpeg');
  });

  it('omits rows the asset carries nothing for', () => {
    // Four empty rows read as data the user should go and fix; usually the
    // file simply never carried the field.
    expect(assetFacts(detail()).map((f) => f.key)).toEqual(['file']);
  });

  it('labels the date row rather than leaving the value unexplained', () => {
    const facts = assetFacts(detail({ taken_at: '2024-11-24T07:12:00Z' }));
    const date = facts.find((f) => f.key === 'date');
    expect(date?.primary).toMatch(/24 Nov 2024, \d{2}:\d{2}/);
    expect(date?.secondary).toBe('Capture date');
  });

  it('keeps a malformed date visible instead of rendering Invalid Date', () => {
    const facts = assetFacts(detail({ taken_at: 'not-a-date' }));
    expect(facts.find((f) => f.key === 'date')?.primary).toBe('not-a-date');
  });

  it('joins make and model without repeating a make the model already carries', () => {
    expect(assetFacts(detail({ camera_make: 'Google', camera_model: 'Pixel 8 Pro' }))
      .find((f) => f.key === 'camera')?.primary).toBe('Google Pixel 8 Pro');

    // Apple writes the make into the model, which used to double up.
    expect(assetFacts(detail({ camera_make: 'Apple', camera_model: 'Apple iPhone 15' }))
      .find((f) => f.key === 'camera')?.primary).toBe('Apple iPhone 15');
  });

  it('has no camera row for a screenshot', () => {
    // A MIME type is not a camera.
    expect(assetFacts(detail({ camera_make: '  ', camera_model: '' })).some((f) => f.key === 'camera')).toBe(false);
  });

  it('names the place only once the server has resolved one', () => {
    const facts = assetFacts(detail({ place_city: 'Coorg', place_country: 'India' }));
    const place = facts.find((f) => f.key === 'place');
    expect(place?.primary).toBe('Coorg, India');
    expect(place?.secondary).toBe('Resolved on your server');

    // Coordinates alone are not a place.
    expect(assetFacts(detail({ gps_lat: 12.4, gps_lon: 75.7 })).some((f) => f.key === 'place')).toBe(false);
  });

  it('orders rows file, date, camera, place', () => {
    const facts = assetFacts(
      detail({
        taken_at: '2024-11-24T07:12:00Z',
        camera_make: 'Google',
        camera_model: 'Pixel 8 Pro',
        place_city: 'Coorg',
        place_country: 'India',
      }),
    );
    expect(facts.map((f) => f.key)).toEqual(['file', 'date', 'camera', 'place']);
  });
});
